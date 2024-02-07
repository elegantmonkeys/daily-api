import { subYears } from 'date-fns';
import { getUserReadingRank, ReadingRank, getUserReadingTags } from './users';
import { Post, Source, View } from '../entity';
import { User } from '../entity';
import { ReadingDaysArgs } from './users';
import { ActiveView } from '../entity/ActiveView';
import { DataSource } from 'typeorm';

export interface MostReadTag {
  value: string;
  count: number;
  percentage?: number;
}

export const getMostReadTags = async (
  con: DataSource,
  args: ReadingDaysArgs,
): Promise<MostReadTag[]> => {
  const result = await getUserReadingTags(con, args);

  return result.map(({ tag, readingDays, ...props }) => ({
    value: tag,
    count: readingDays,
    ...props,
  }));
};

interface FavoriteSourcesProps {
  alias: string;
  limit: number;
}

export const generateFavoriteSourcesQuery = (
  con: DataSource,
  userId: string,
  { alias = 'source', limit = 5 }: Partial<FavoriteSourcesProps> = {},
) => {
  return con
    .createQueryBuilder()
    .select(`p."sourceId"`, 'id')
    .from(View, 'v')
    .innerJoin(Post, 'p', 'v."postId" = p.id')
    .innerJoin(
      (qb) =>
        qb
          .select('"sourceId"')
          .addSelect('count(*)', 'count')
          .from(Post, 'post')
          .groupBy('"sourceId"'),
      's',
      's."sourceId" = p."sourceId"',
    )
    .innerJoin(
      Source,
      alias,
      `"${alias}".id = p."sourceId" and "${alias}".active = true and "${alias}".private = false`,
    )
    .where('v."userId" = :id', { id: userId })
    .andWhere(`s.count > 10`)
    .groupBy('p."sourceId"')
    .orderBy('count(*) * 1.0 / min(s.count)', 'DESC')
    .limit(limit);
};

export const getFavoriteSourcesIds = async (
  con: DataSource,
  userId: string,
  limit = 5,
): Promise<string[]> => {
  const query = generateFavoriteSourcesQuery(con, userId, { limit });
  const sources = await query.getRawMany();

  return sources.map((source) => source.id);
};

export const getFavoriteSourcesLogos = async (
  con: DataSource,
  userId: string,
): Promise<string[]> => {
  const alias = 'source';
  const query = generateFavoriteSourcesQuery(con, userId, {
    alias,
    limit: 5,
  }).addSelect(`min("${alias}".image)`, 'image');
  const sources = await query.getRawMany();

  return sources.map((source) => source.image);
};

type DevCardData = {
  user: User;
  articlesRead: number;
  tags: { value: string; count: number }[];
  sourcesLogos: string[];
  rank: ReadingRank;
};

export async function getDevCardData(
  userId: string,
  con: DataSource,
): Promise<DevCardData> {
  const now = new Date();
  const start = subYears(now, 1).toISOString();
  const end = now.toISOString();
  const user = await con.getRepository(User).findOneByOrFail({ id: userId });
  const [articlesRead, tags, sourcesLogos, rank] = await Promise.all([
    con.getRepository(ActiveView).countBy({ userId }),
    getMostReadTags(con, { userId, limit: 4, dateRange: { start, end } }),
    getFavoriteSourcesLogos(con, userId),
    getUserReadingRank(con, userId, user?.timezone, 2),
  ]);
  return { user, articlesRead, tags, sourcesLogos, rank };
}

const uppercaseTags = ['css', 'html', 'aws', 'gcp'];

export function transformTag(tag: string): string {
  if (uppercaseTags.indexOf(tag) > -1) {
    return tag.toUpperCase();
  }
  const separateWord = tag.replace(/-/g, ' ').split(' ');
  for (let i = 0; i < separateWord.length; i++) {
    separateWord[i] =
      separateWord[i].charAt(0).toUpperCase() + separateWord[i].substring(1);
  }
  return separateWord.join(' ');
}

export function largeNumberFormat(value: number): string {
  let newValue = value;
  const suffixes = ['', 'K', 'M', 'B', 'T'];
  let suffixNum = 0;
  while (newValue >= 1000) {
    newValue /= 1000;
    suffixNum++;
  }
  if (suffixNum > 0) {
    return newValue.toFixed(1) + suffixes[suffixNum];
  }
  return newValue.toString();
}
