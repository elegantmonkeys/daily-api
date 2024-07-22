import { NativeConnection, Worker } from '@temporalio/worker';
import { createActivities } from './activities';
import createOrGetConnection from '../../db';
import { WorkflowQueue } from '../common';
import { TEMPORAL_ADDRESS } from '../config';

export async function run() {
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });
  const dbCon = await createOrGetConnection();
  const worker = await Worker.create({
    connection,
    workflowsPath: require.resolve('./workflows'),
    taskQueue: WorkflowQueue.Notification,
    activities: createActivities({ con: dbCon }),
  });

  await worker.run();
}
