import { AuthenticationError } from 'apollo-server-errors';
import { defaultFieldResolver } from 'graphql';
import { GraphQLSchema } from 'graphql';
import { mapSchema, getDirective, MapperKind } from '@graphql-tools/utils';
import { Context } from '../Context';

const directiveName = 'feedPlus';

export const typeDefs = /* GraphQL */ `
  """
  Directive that restricts access to a field or object type to users with a Plus subscription unless it's their main feed
  """
  directive @${directiveName} on OBJECT | FIELD_DEFINITION
`;

export const transformer = (schema: GraphQLSchema): GraphQLSchema =>
  mapSchema(schema, {
    [MapperKind.OBJECT_FIELD]: (fieldConfig, _fieldName, typeName) => {
      const feedPlusDirective = getDirective(
        schema,
        fieldConfig,
        directiveName,
      )?.[0];

      if (feedPlusDirective) {
        const { resolve = defaultFieldResolver } = fieldConfig;
        fieldConfig.resolve = function (source, args, ctx: Context, info) {
          if (
            !ctx.userId ||
            (args?.feedId && ctx.userId !== args?.feedId && !ctx.isPlus)
          ) {
            if (['Query', 'Mutation'].includes(typeName)) {
              throw new AuthenticationError(
                'Access denied! You need to be authorized to perform this action!',
              );
            }

            resolve(source, args, ctx, info);
            return null;
          }
          return resolve(source, args, ctx, info);
        };
        return fieldConfig;
      }
    },
  });
