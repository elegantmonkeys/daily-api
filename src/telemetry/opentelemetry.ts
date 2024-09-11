import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Message } from '@google-cloud/pubsub';

import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { FastifyInstrumentation } from '@opentelemetry/instrumentation-fastify';
import { GraphQLInstrumentation } from '@opentelemetry/instrumentation-graphql';
import { GrpcInstrumentation } from '@opentelemetry/instrumentation-grpc';
import { TypeormInstrumentation } from 'opentelemetry-instrumentation-typeorm';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

import dc from 'node:diagnostics_channel';

import { NodeSDK, logs, node, api, resources } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { GcpDetectorSync } from '@google-cloud/opentelemetry-resource-util';
// import { CloudPropagator } from '@google-cloud/opentelemetry-cloud-trace-propagator';

import { containerDetector } from '@opentelemetry/resource-detector-container';
import { gcpDetector } from '@opentelemetry/resource-detector-gcp';

import { isProd } from '../common/utils';
import {
  channelName,
  getAppVersion,
  SEMATTRS_DAILY_APPS_USER_ID,
  SEMATTRS_DAILY_APPS_VERSION,
} from './common';
import {
  SEMATTRS_MESSAGING_DESTINATION,
  SEMATTRS_MESSAGING_MESSAGE_ID,
  SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES,
  SEMATTRS_MESSAGING_SYSTEM,
} from '@opentelemetry/semantic-conventions';

const resourceDetectors = [
  resources.envDetectorSync,
  resources.hostDetectorSync,
  resources.osDetectorSync,
  resources.processDetectorSync,
  containerDetector,
  gcpDetector,
  new GcpDetectorSync(),
];

export const addApiSpanLabels = (
  span: api.Span,
  req: FastifyRequest,
  // TODO: see if we want to add some attributes from the response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  res?: FastifyReply,
): void => {
  span.setAttributes({
    [SEMATTRS_DAILY_APPS_VERSION]: getAppVersion(req),
    [SEMATTRS_DAILY_APPS_USER_ID]: req.userId || req.trackingId || 'unknown',
  });
};

export const addPubsubSpanLabels = (
  span: api.Span,
  subscription: string,
  message: Message | { id: string; data?: Buffer },
): void => {
  span.setAttributes({
    [SEMATTRS_MESSAGING_SYSTEM]: 'pubsub',
    [SEMATTRS_MESSAGING_DESTINATION]: subscription,
    [SEMATTRS_MESSAGING_MESSAGE_ID]: message.id,
    [SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES]: message.data.length,
  });
};

const instrumentations = [
  new HttpInstrumentation({
    // Ignore specific endpoints like health checks or internal metrics
    ignoreIncomingRequestHook: (request) => {
      const ignorePaths = ['/health', '/liveness', '/metrics'];
      return ignorePaths.some((path) => request.url?.includes(path));
    },
  }),
  new FastifyInstrumentation({
    requestHook: (span, info) => {
      addApiSpanLabels(span, info.request as FastifyRequest);
    },
  }),
  new GraphQLInstrumentation({
    mergeItems: true,
    ignoreTrivialResolveSpans: true,
  }),
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
  new UndiciInstrumentation(),
];

api.diag.setLogger(new api.DiagConsoleLogger(), api.DiagLogLevel.INFO);

export const tracer = (serviceName: string) => {
  if (process.env.OTEL_ENABLED !== 'true') {
    return {
      start: () => {},
      tracer: api.trace.getTracer('noop'),
    };
  }

  const traceExporter = isProd
    ? new TraceExporter()
    : new OTLPTraceExporter({
        url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      });

  const spanProcessor = new node.BatchSpanProcessor(traceExporter);

  const sdk = new NodeSDK({
    serviceName,
    logRecordProcessor: new logs.SimpleLogRecordProcessor(
      new logs.ConsoleLogRecordExporter(),
    ),
    spanProcessors: [spanProcessor],
    instrumentations,
    resourceDetectors,
    // textMapPropagator: new CloudPropagator(),
  });

  dc.subscribe(channelName, ({ fastify }: { fastify: FastifyInstance }) => {
    fastify.decorate('tracer', api.trace.getTracer(serviceName));
    fastify.decorateRequest('span', null);

    fastify.addHook('onRequest', async (req) => {
      req.span = api.trace.getSpan(api.context.active());
    });

    // Decorate the main span with some metadata
    fastify.addHook('onResponse', async (req, res) => {
      addApiSpanLabels(req.span, req, res);
    });
  });

  ['SIGINT', 'SIGTERM'].forEach((signal) => {
    process.on(signal, () => sdk.shutdown().catch(console.error));
  });

  return {
    start: () => {
      sdk.start();
    },
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

export { api as opentelemetry };
