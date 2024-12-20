import { Storage, DownloadOptions } from '@google-cloud/storage';
import { PropsParameters } from '../types';
import path from 'path';
import { BigQuery } from '@google-cloud/bigquery';
import { Query } from '@google-cloud/bigquery/build/src/bigquery';
import { subDays } from 'date-fns';

export const downloadFile = async ({
  url,
  options,
}: {
  url: string;
  options?: DownloadOptions;
}): Promise<string> => {
  const bucket = path.dirname(url);
  const fileName = path.basename(url);
  const storage = new Storage();

  const [result] = await storage
    .bucket(bucket)
    .file(fileName)
    .download(options);

  return result.toString();
};

export const downloadJsonFile = async <T>({
  url,
  options,
}: PropsParameters<typeof downloadFile>): Promise<T> => {
  const result = await downloadFile({ url, options });

  return JSON.parse(result);
};

export enum UserActiveState {
  Active = '1',
  InactiveSince6wAgo = '2',
  InactiveSince12wAgo = '3',
  NeverActive = '4',
}

export const userActiveStateQuery = `
  with d as (
    select u.primary_user_id,
    min(last_app_timestamp) as last_app_timestamp,
    min(registration_timestamp) as registration_timestamp,
    min(
        case
          when period_end is null then '4'
          when period_end between date(@previous_date - interval 6*7 day) and @previous_date then '1'
          when period_end between date(@previous_date - interval 12*7 day) and date(@previous_date - interval 6*7 + 1 day) then '2'
          when date(u.last_app_timestamp) <  date(@previous_date - interval 12*7 day) then '3'
          when date(u.registration_timestamp) <  date(@previous_date - interval 12*7 day) then '3'
          else '4' end
      ) as previous_state,
      min(
        case
            when period_end is null then '4'
            when period_end between date(@run_date - interval 6*7 day) and @run_date then '1'
            when period_end between date(@run_date - interval 12*7 day) and date(@run_date - interval 6*7 + 1 day) then '2'
            when date(u.last_app_timestamp) <  date(@run_date - interval 12*7 day) then '3'
            when date(u.registration_timestamp) <  date(@run_date - interval 12*7 day) then '3'
            else '4' end
      ) as current_state,
    from analytics.user as u
    left join analytics.user_state_sparse as uss on uss.primary_user_id = u.primary_user_id
      and uss.period_end between date(@previous_date - interval 12* 7 day) and @run_date
      and uss.period = 'daily'
      and uss.app_active_state = 'active'
      and uss.registration_state = 'registered'
    where u.registration_timestamp is not null
    and date(u.registration_timestamp) < @run_date
    group by 1
  )
  select *
  from d
  where current_state != previous_state
  and previous_state != '4'
`;

export const getUserActiveStateQuery = (
  runDate: Date,
  query = userActiveStateQuery,
): Query => {
  const run_date = runDate.toISOString().split('T')[0];
  const previous_date = subDays(runDate, 1).toISOString().split('T')[0];

  return { query, params: { previous_date, run_date } };
};

export interface GetUsersActiveState {
  inactiveUsers: string[];
  downgradeUsers: string[];
  reactivateUsers: string[];
}

export interface UserActiveStateData {
  current_state: UserActiveState;
  previous_state: UserActiveState;
  primary_user_id: string;
}

const bigquery = new BigQuery();

export const queryFromBq = async (
  query: Query,
): Promise<UserActiveStateData[]> => {
  const [job] = await bigquery.createQueryJob(query);
  const [rows] = await job.getQueryResults();
  console.log('rows: ', rows);

  return rows;
};

export const sortUsersActiveState = (users: UserActiveStateData[]) => {
  const inactiveUsers: string[] = [];
  const downgradeUsers: string[] = [];
  const reactivateUsers: string[] = [];

  // sort users from bq into active, inactive, downgrade, and reactivate
  for (const user of users) {
    if (
      user.current_state === UserActiveState.InactiveSince6wAgo &&
      user.previous_state === UserActiveState.Active
    ) {
      downgradeUsers.push(user.primary_user_id);
    } else if (
      user.current_state === UserActiveState.Active &&
      user.previous_state !== UserActiveState.Active
    ) {
      reactivateUsers.push(user.primary_user_id);
    } else if (
      user.current_state === UserActiveState.InactiveSince12wAgo &&
      user.previous_state !== UserActiveState.InactiveSince12wAgo
    ) {
      inactiveUsers.push(user.primary_user_id);
    }
  }

  return { inactiveUsers, downgradeUsers, reactivateUsers };
};

export const getUsersActiveState = async (
  runDate: Date,
): Promise<GetUsersActiveState> => {
  const query = getUserActiveStateQuery(runDate);
  const usersFromBq = await queryFromBq(query);

  return sortUsersActiveState(usersFromBq);
};
