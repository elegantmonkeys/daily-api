import { FastifyInstance } from 'fastify';
import isbot from 'isbot';
import { getConnection } from 'typeorm';
import { Post } from '../entity';
import { notifyView } from '../common';

export default async function (fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { postId: string }; Querystring: { a?: string } }>(
    '/:postId',
    async (req, res) => {
      const con = getConnection();
      const post = await con.getRepository(Post).findOne({
        select: ['id', 'url', 'tagsStr'],
        where: [{ id: req.params.postId }, { shortId: req.params.postId }],
      });
      if (!post) {
        return res.status(404).send();
      }
      if (!req.headers['user-agent'] || isbot(req.headers['user-agent'])) {
        return res.status(302).redirect(post.url);
      }
      const hostname = new URL(post.url).hostname
      const userId = req.userId || req.cookies.da2;
      if (userId) {
        notifyView(
          req.log,
          post.id,
          userId,
          req.headers['referer'],
          new Date(),
          post.tagsStr?.split?.(',') ?? [],
        );
      }
      return res
        .type('text/html')
        .send(
          `<html><head><link href="${hostname}" rel="preconnect" pr="1.00" crossorigin><meta http-equiv="refresh" content="0;URL=${
            post.url
          }${req.query.a ? `#${req.query.a}` : ""}"></head></html>`
        );
    },
  );
}
