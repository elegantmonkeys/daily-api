import '../src/config';
import {
  Alerts,
  Comment,
  Post,
  PostType,
  SourceMember,
  UserActionType,
  User,
} from '../src/entity';
import createOrGetConnection from '../src/db';
import { SourceMemberRoles } from '../src/roles';
import { DataSource } from 'typeorm';

const insertSelectAction = (
  con: DataSource,
  [query, params]: [string, unknown[]],
) => con.query(`INSERT INTO user_action("userId", type) ${query}`, params);

const getSourceAdminQuery = async (con: DataSource) =>
  con
    .createQueryBuilder()
    .select('DISTINCT sm."userId"')
    .addSelect(`'${UserActionType.CreateSquad}'`, 'type')
    .from(SourceMember, 'sm')
    .where('sm.role = :role', { role: SourceMemberRoles.Admin })
    .getQueryAndParameters();

const getSourceNonAdminQuery = async (con: DataSource) =>
  con
    .createQueryBuilder()
    .select('DISTINCT sm."userId"')
    .addSelect(`'${UserActionType.JoinSquad}'`, 'type')
    .from(SourceMember, 'sm')
    .where('sm.role != :role', { role: SourceMemberRoles.Admin })
    .getQueryAndParameters();

const getFirstCommentQuery = async (con: DataSource) =>
  con
    .createQueryBuilder()
    .select('DISTINCT c."userId"')
    .addSelect(`'${UserActionType.SquadFirstComment}'`, 'type')
    .from(Comment, 'c')
    .innerJoin(Post, 'p', 'p.id = c."postId"')
    .where('p.type = :type', { type: PostType.Share })
    .getQueryAndParameters();

const getFirstPostQuery = async (con: DataSource) =>
  con
    .createQueryBuilder()
    .select('DISTINCT p."authorId"', 'userId')
    .addSelect(`'${UserActionType.SquadFirstPost}'`, 'type')
    .from(Post, 'p')
    .where('p.type = :type', { type: PostType.Share })
    .getQueryAndParameters();

const getSquadInviteQuery = async (con: DataSource) =>
  con
    .createQueryBuilder()
    .select('DISTINCT u."referralId"', 'userId')
    .addSelect(`'${UserActionType.SquadInvite}'`, 'type')
    .from(User, 'u')
    .where('u."referralId" IS NOT NULL')
    .getQueryAndParameters();

const getFilterQuery = async (con: DataSource) =>
  con
    .createQueryBuilder()
    .select('DISTINCT a."userId"')
    .addSelect(`'${UserActionType.MyFeed}'`, 'type')
    .from(Alerts, 'a')
    .where('a.filter IS FALSE')
    .getQueryAndParameters();

export const retroCheckActions = async (ds?: DataSource): Promise<void> => {
  const con = ds ?? (await createOrGetConnection());
  const adminQuery = await getSourceAdminQuery(con);
  const nonAdminQuery = await getSourceNonAdminQuery(con);
  const commentsQuery = await getFirstCommentQuery(con);
  const postsQuery = await getFirstPostQuery(con);
  const inviteQuery = await getSquadInviteQuery(con);
  const filterQuery = await getFilterQuery(con);
  const queries = [
    commentsQuery,
    postsQuery,
    inviteQuery,
    adminQuery,
    nonAdminQuery,
    filterQuery,
  ];

  await Promise.all(queries.map((args) => insertSelectAction(con, args)));
};

if (process.env.NODE_ENV !== 'test') {
  retroCheckActions();
}
