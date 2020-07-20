import '../src/config';
import shortid from 'shortid';
import { createOrGetConnection } from '../src/db';
import { Post } from '../src/entity';

interface Row {
  id: string;
}

(async (): Promise<void> => {
  const con = await createOrGetConnection();

  const resStream = await con
    .createQueryBuilder()
    .select('id')
    .from(Post, 'p')
    .where('p."shortId" is NULL')
    .limit(10000)
    .stream();

  let index = 0;
  resStream.on('data', async ({ id }: Row) => {
    console.log(`updating ${index}`);
    index++;
    await con
      .createQueryBuilder()
      .update(Post)
      .set({ shortId: shortid.generate() })
      .where({ id })
      .execute();
  });
  await new Promise((resolve, reject) => {
    resStream.on('error', reject);
    resStream.on('end', resolve);
  });
})();
