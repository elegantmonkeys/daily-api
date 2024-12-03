import { readFileSync } from 'fs';
import createOrGetConnection from '../src/db';
import { DataSource } from 'typeorm';
import { SourceTagView } from '../src/entity/SourceTagView';
import { TagRecommendation } from '../src/entity/TagRecommendation';
import { PopularPost } from '../src/entity/PopularPost';
import { PopularSource } from '../src/entity/PopularSource';
import { PopularTag } from '../src/entity/PopularTag';
import { PopularVideoPost } from '../src/entity/PopularVideoPost';
import { PopularVideoSource } from '../src/entity/PopularVideoSource';
import { TrendingPost } from '../src/entity/TrendingPost';
import { TrendingSource } from '../src/entity/TrendingSource';
import { TrendingTag } from '../src/entity/TrendingTag';
import { UserStats } from '../src/entity/user/UserStats';

const importEntity = async (
  con: DataSource,
  name: string,
  options: {
    conflictPaths?: string[];
  } = {},
): Promise<void> => {
  console.log(`importing ${name}`);
  const entities = JSON.parse(readFileSync(`./seeds/${name}.json`).toString());
  const repository = con.getRepository(name);
  // Batch insert with dirty hack
  for (let i = 0; i < entities.length; i += 1000) {
    if (options.conflictPaths) {
      await repository.upsert(
        entities.slice(i, i + 1000),
        options.conflictPaths,
      );
    } else {
      await repository.insert(entities.slice(i, i + 1000));
    }
  }
};

const viewsToRefresh = [
  TagRecommendation,
  SourceTagView,
  TrendingPost,
  TrendingSource,
  TrendingTag,
  PopularPost,
  PopularSource,
  PopularTag,
  PopularVideoPost,
  PopularVideoSource,
  UserStats,
];

const start = async (): Promise<void> => {
  const con = await createOrGetConnection();
  await importEntity(con, 'AdvancedSettings');
  await importEntity(con, 'SourceCategory');
  await importEntity(con, 'Source');
  await importEntity(con, 'Post');
  await importEntity(con, 'YouTubePost');
  await importEntity(con, 'Category');
  await importEntity(con, 'Keyword', { conflictPaths: ['value'] });
  await importEntity(con, 'PostKeyword');
  await importEntity(con, 'User');
  await importEntity(con, 'UserTopReader');
  await importEntity(con, 'MarketingCta');
  await importEntity(con, 'SourceMember');
  await importEntity(con, 'ContentPreferenceSource');
  // Manually have to reset these as insert has a issue with `type` columns
  await con.query(`update post set type = 'article' where type = 'Post'`);
  await con.query(`update source set type = 'machine' where type = 'Source'`);
  await con.query(`update source set type = 'squad' where id = 'publicsquad'`);
  await con.transaction(async (manager) => {
    for (const viewToRefresh of viewsToRefresh) {
      await manager.query(
        `REFRESH MATERIALIZED VIEW ${con.getRepository(viewToRefresh).metadata.tableName}`,
      );
    }
  });
};

start()
  .then(() => {
    console.log('done');
    process.exit();
  })
  .catch((err) => {
    console.error(err);
    process.exit(-1);
  });
