import { ApiBody, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
/** Publish the exact validator used by a controller as its OpenAPI input contract. */
export function Input(schema: z.ZodType) {
  return ApiBody({
    required: true,
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: 'any',
    }) as SchemaObject,
  });
}
