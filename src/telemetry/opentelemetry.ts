import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Message } from '@google-cloud/pubsub';

import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { GraphQLInstrumentation } from '@opentelemetry/instrumentation-graphql';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { TypeormInstrumentation } from 'opentelemetry-instrumentation-typeorm';

import { NodeSDK, logs, node, api, resources } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { CloudPropagator } from '@google-cloud/opentelemetry-cloud-trace-propagator';

// import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
// import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

import { containerDetector } from '@opentelemetry/resource-detector-container';
import { gcpDetector } from '@opentelemetry/resource-detector-gcp';

import dc from 'node:diagnostics_channel';
const channel = dc.channel('fastify.initialization');

// const metricExporter = new OTLPMetricExporter({
//   // hostname: 'jaeger-collector',
//   url: `http://${process.env.OTLP_COLLECTOR_HOST}:${process.env.OTLP_COLLECTOR_PORT}`,
// });
const isProd = process.env.NODE_ENV === 'production';
const resourceDetectors = [
  resources.envDetectorSync,
  resources.hostDetectorSync,
  resources.osDetectorSync,
  resources.processDetectorSync,
  containerDetector,
  gcpDetector,
];

const traceExporter = isProd
  ? new TraceExporter()
  : new OTLPTraceExporter({
      // hostname: 'jaeger-collector',
      url: `http://${process.env.OTLP_COLLECTOR_HOST}:${process.env.OTLP_COLLECTOR_PORT}`,
    });

const spanProcessor = isProd
  ? new node.BatchSpanProcessor(traceExporter)
  : new node.SimpleSpanProcessor(traceExporter);

export const addApiSpanLabels = (
  span: api.Span,
  req: FastifyRequest,
  // TODO: see if we want to add some attributes from the response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  res?: FastifyReply,
): void => {
  span.setAttributes({
    ['dailydev.apps.version']: req.query['v'] || 'unknown',
    ['dailydev.apps.userId']: req.userId || 'unknown',
    ['dailydev.heimdall.session']: req.cookies['das'] || 'unknown',
  });
};

export const addPubsubSpanLabels = (
  span: api.Span,
  subscription: string,
  message: Message | { id: string; data?: Buffer },
): void => {
  span.setAttributes({
    [SemanticAttributes.MESSAGING_SYSTEM]: 'pubsub',
    [SemanticAttributes.MESSAGING_DESTINATION]: subscription,
    [SemanticAttributes.MESSAGING_MESSAGE_ID]: message.id,
    [SemanticAttributes.MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES]:
      message.data.length,
  });
};

const instrumentations = [
  new HttpInstrumentation(),
  new FastifyInstrumentation({
    requestHook: (span, info) => {
      addApiSpanLabels(span, info.request as FastifyRequest);
    },
  }),
  new GraphQLInstrumentation({
    mergeItems: true,
    ignoreTrivialResolveSpans: true,
  }),
  new PinoInstrumentation(),
  // Did not really get anything from IORedis
  new IORedisInstrumentation(),
  // TODO: remove this once pubsub has implemented the new tracing methods
  new GrpcInstrumentation({
    ignoreGrpcMethods: ['ModifyAckDeadline'],
  }),
  // Postgres instrumentation will be supressed if it is a child of typeorm
  new PgInstrumentation(),
  new TypeormInstrumentation({
    suppressInternalInstrumentation: true,
  }),
];

api.diag.setLogger(new api.DiagConsoleLogger(), api.DiagLogLevel.INFO);

export const tracer = (serviceName: string) => {
  const sdk = new NodeSDK({
    serviceName,
    logRecordProcessor: new logs.SimpleLogRecordProcessor(
      new logs.ConsoleLogRecordExporter(),
    ),
    spanProcessor,
    instrumentations,
    resourceDetectors,
    textMapPropagator: new CloudPropagator(),
  });

  channel.subscribe(({ fastify }: { fastify: FastifyInstance }) => {
    fastify.decorate('tracer', api.trace.getTracer('fastify'));

    // TODO: see if this is needed
    fastify.decorateRequest('span', null);
    fastify.addHook('onRequest', async (req) => {
      req.span = api.trace.getSpan(api.context.active());
    });

    // Decorate the main span with some metadata
    fastify.addHook('onResponse', async (req, res) => {
      const currentSpan = api.trace.getSpan(api.context.active());
      addApiSpanLabels(currentSpan, req, res);
    });
  });

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => sdk.shutdown().catch(console.error));
  });

  return {
    start: () => sdk.start(),
    tracer,
  };
};

export const runInSpan = async <T>(
  name: string,
  func: (span: api.Span) => Promise<T>,
  options?: api.SpanOptions,
): Promise<T> =>
  api.trace
    .getTracer('runInSpan')
    .startActiveSpan(name, options, async (span) => {
      try {
        return await func(span);
      } catch (err) {
        span.setStatus({
          code: api.SpanStatusCode.ERROR,
          message: err?.message,
        });
        throw err;
      } finally {
        span.end();
      }
    });

export const runInSpanSync = <T>(
  name: string,
  func: (span: api.Span) => T,
  options?: api.SpanOptions,
): T =>
  api.trace.getTracer('runInSpan').startActiveSpan(name, options, (span) => {
    try {
      return func(span);
    } catch (err) {
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: err?.message,
      });
      throw err;
    } finally {
      span.end();
    }
  });

export const runInRootSpan = async <T>(
  name: string,
  func: (span: api.Span) => Promise<T>,
  options?: api.SpanOptions,
): Promise<T> => runInSpan(name, func, { ...options, root: true });

export const runInRootSpanSync = <T>(
  name: string,
  func: (span: api.Span) => T,
  options?: api.SpanOptions,
): T => runInSpanSync(name, func, { ...options, root: true });

export const { trace, context, SpanStatusCode, SpanKind } = api;
export { SemanticAttributes };
