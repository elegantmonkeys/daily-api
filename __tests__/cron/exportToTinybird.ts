import { DataSource } from 'typeorm';
import { saveFixtures } from '../helpers';
import createOrGetConnection from '../../src/db';
import { ArticlePost, PostTag, Source, User } from '../../src/entity';
import { sourcesFixture } from '../fixture/source';
import { postsFixture, postTagsFixture } from '../fixture/post';
import {
  PostsRepository,
  TinybirdError,
  TinybirdDatasourceMode,
  PostsMetadataRepository,
  ITinybirdClient,
  TinybirdPost, TinybirdClient, fetchfn,
} from '../../src/cron/exportToTinybird';
import * as fs from 'fs';
import * as path from 'path';
import fetch from "node-fetch";

let con: DataSource;

beforeAll(async () => {
  con = await createOrGetConnection();
});

beforeEach(async () => {
  jest.clearAllMocks();

  await saveFixtures(con, Source, sourcesFixture);
  await saveFixtures(con, ArticlePost, postsFixture);
  await saveFixtures(con, PostTag, postTagsFixture);
  await con
    .getRepository(User)
    .save({ id: '1', name: 'Ido', image: 'https://daily.dev/ido.jpg' });
  await con.getRepository(User).save({
    id: '2',
    name: 'Lee',
    image: 'https://daily.dev/lee.jpg',
  });
});

describe('PostsRepository', () => {
  it('should return posts to export to tinybird with specific properties', async () => {
    const now = new Date();
    const latest = new Date(now.getTime() - 10000);
    const repo = new PostsRepository(con);

    const posts = await repo.getForTinybirdExport(latest);
    posts.forEach((post) => {
      post.created_at = '';
      post.metadata_changed_at = '';
    });
    expect(posts).toMatchSnapshot();
  });
});

describe('TinybirdClient', () => {
  return;
});

describe('PostsMetadataRepository', () => {
  it('latest', async () => {
    const tinybirdClient = new TinybirdClient(
      process.env.TINYBIRD_TOKEN,
      process.env.TINYBIRD_HOST,
      fetch as unknown as fetchfn,
    );

    const postsMetadataRepository = new PostsMetadataRepository(
      tinybirdClient,
      'posts_metadata',
    );

    const response = await postsMetadataRepository.latest();
    expect(response.error).toBeNull();
  });

  it('append', async () => {
    const expectedCsv = fs
      .readFileSync(
        path.resolve(__dirname, './testdata/expected_tinybird_export.csv'),
      )
      .toString();

    const expectedDataSource = 'posts_metadata';
    const tinybirdMock = {
      postToDatasource: (
        datasource: string,
        mode: TinybirdDatasourceMode,
        csv: string,
      ): Promise<null | TinybirdError> => {
        expect(datasource).toEqual(expectedDataSource);
        expect(mode).toEqual(TinybirdDatasourceMode.APPEND);
        expect(csv + '\n').toEqual(expectedCsv);

        return null;
      },
    } as ITinybirdClient;

    const postsMetadataRepository = new PostsMetadataRepository(
      tinybirdMock,
      expectedDataSource,
    );

    const posts: TinybirdPost[] = [
      {
        id: 'id1',
        author_id: 'author_id1',
        created_at: 'created_at',
        metadata_changed_at: 'metadata_changed_at',
        creator_twitter: 'creator_twitter',
        source_id: 'source_id',
        tags_str: 'tags_str',
        post_type: 'post_type',
        post_private: 1,
        content_curation: ['content_curation'],
        source_type: 'source_type',
      },
      {
        id: 'id2',
        author_id: 'author_id2',
        created_at: 'created_at2',
        metadata_changed_at: 'metadata_changed_at2',
        creator_twitter: 'creator_twitter2',
        source_id: 'source_id2',
        tags_str: 'tags_str2',
        post_type: 'post_type2',
        post_private: 1,
        content_curation: ['content_curation1', 'content_curation2'],
        source_type: 'source_type2',
      },
    ];
    const result = await postsMetadataRepository.append(posts);
    expect(result).toBeNull();
  });
});
