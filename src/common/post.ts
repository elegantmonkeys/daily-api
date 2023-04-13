import { DataSource } from 'typeorm';
import fetch from 'node-fetch';
import { User } from '../entity';
import { Comment, ExternalLinkPreview, Post } from '../entity';

export const defaultImage = {
  urls: process.env.DEFAULT_IMAGE_URL?.split?.(',') ?? [],
  ratio: parseFloat(process.env.DEFAULT_IMAGE_RATIO),
  placeholder: process.env.DEFAULT_IMAGE_PLACEHOLDER,
};

export const pickImageUrl = (post: {
  createdAt: Date | string | number;
}): string =>
  defaultImage.urls[
    Math.floor(new Date(post.createdAt).getTime() / 1000) %
      defaultImage.urls.length
  ];

interface PostCommentersProps {
  limit?: number;
  userId?: string;
}

export const getPostCommenterIds = async (
  con: DataSource,
  postId: string,
  { userId, limit = 4 }: PostCommentersProps,
): Promise<string[]> => {
  let queryBuilder = con
    .getRepository(Comment)
    .createQueryBuilder('c')
    .select(`DISTINCT c."userId"`)
    .innerJoin(User, 'u', 'u.id = c."userId"')
    .where('c."postId" = :postId', { postId })
    .andWhere('u.username IS NOT NULL');

  if (userId) {
    queryBuilder = queryBuilder.andWhere('c."userId" != :userId', { userId });
  }

  if (limit) {
    queryBuilder = queryBuilder.limit(limit);
  }

  const result = await queryBuilder.getRawMany<Comment>();

  return result.map((comment) => comment.userId);
};

export const hasAuthorScout = (post: Post): boolean =>
  !!post?.authorId || !!post?.scoutId;

export const linkPreviewOrigin = process.env.LINK_PREVIEW_ORIGIN;

export const fetchLinkPreview = async (
  url: string,
): Promise<ExternalLinkPreview> => {
  const res = await fetch(`${linkPreviewOrigin}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': '' },
    body: JSON.stringify({ url }),
  });

  return res.json();
};
