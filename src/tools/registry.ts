/**
 * Tool Registry da TRACECON.
 *
 * O agente (IA) NÃO possui poder discricionário para calcular tudo: ele é um
 * orquestrador de ferramentas especializadas. Cada ferramenta é declarada aqui
 * com um schema de entrada (zod), uma descrição para o modelo e um handler
 * tipado. O registry valida argumentos e impõe limites de execução.
 *
 * Para evitar problemas de variância/deep-typing, cada `ToolDefinition` é
 * fornecida por `defineTool`, que preserva a tipagem do schema no ponto de
 * criação e o normaliza para armazenamento/comunicação com o modelo.
 */
import { z } from "zod";

/** Base de qualquer schema de argumento (ZodType de qualquer shape). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyArgs = z.ZodType<any>;

/** Definição normalizada usada internamente (handler de argumentos validados). */
export type InvokeHandler = (args: Record<string, unknown>) => Promise<unknown>;

/** Resultado de registro/uso de uma ferramenta (formato consumível pelo modelo). */
export interface ToolRecord {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** Armazenamento normalizado de uma ferramenta registrada. */
interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly schema: AnyArgs;
  readonly handler: InvokeHandler;
}

/**
 * Cria uma definição declarativa tipada para uma ferramenta.
 * Na prática, ferramentas são registradas direto no `ToolRegistry.register`,
 * que infere a tipagem do schema e do handler.
 */
/** Converte zod → JSON Schema para consumo pelo Anthropic/tool calling. */
function zodToJson(schema: AnyArgs): unknown {
  if (schema instanceof z.ZodString) return { type: "string" };
  if (schema instanceof z.ZodNumber) return { type: "number" };
  if (schema instanceof z.ZodBoolean) return { type: "boolean" };
  if (schema instanceof z.ZodEnum)
    return { type: "string", enum: (schema as z.ZodEnum<[string]>)._def.values as string[] };
  if (schema instanceof z.ZodArray) return { type: "array", items: zodToJson(schema.element) };
  if (schema instanceof z.ZodOptional) return zodToJson((schema as z.ZodOptional<never>).unwrap());
  if (schema instanceof z.ZodObject) return zodObjectToJson(schema as z.ZodObject<Record<string, AnyArgs>>);
  return {};
}

function zodObjectToJson(schema: z.ZodObject<Record<string, AnyArgs>>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, zodSchema] of Object.entries(shape)) {
    properties[key] = zodToJson(zodSchema);
    const isOptional = zodSchema.isOptional() || zodSchema instanceof z.ZodOptional;
    if (!isOptional) required.push(key);
  }
  return { type: "object", properties, required };
}

/** Registro de ferramentas com validação e limites de execução. */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  constructor(private readonly limits: {
    readonly maxConcurrentTools: number;
    readonly maxToolCalls: number;
  }) {}

  /**
   * Registra uma ferramenta inferindo o schema a partir de um objeto zod.
   * Aceita definições literais (handlers tipados no ponto de chamada).
   */
  register<TSchema extends AnyArgs>(definition: {
    readonly name: string;
    readonly description: string;
    readonly schema: TSchema;
    readonly handler: (args: z.infer<TSchema>) => Promise<unknown>;
  }): this {
    if (this.tools.has(definition.name)) {
      throw new Error(`Ferramenta duplicada: ${definition.name}`);
    }
    const handler: InvokeHandler = async (rawArgs) => {
      const parsed = definition.schema.parse(rawArgs);
      return definition.handler(parsed as z.infer<TSchema>);
    };
    this.tools.set(definition.name, {
      name: definition.name,
      description: definition.description,
      schema: definition.schema,
      handler,
    });
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  names(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Lista de definições em formato consumível pelo Anthropic (tool calling). */
  listForModel(): ToolRecord[] {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: zodObjectToJson(t.schema as z.ZodObject<Record<string, AnyArgs>>),
    }));
  }

  /**
   * Executa uma ferramenta validando os argumentos. Nunca lança por ausência
   * de dados (isso é sinalizado via ToolResult). Lança apenas por erro real de
   * operação ou argumento inválido.
   */
  async invoke(name: string, args: unknown): Promise<unknown> {
    const def = this.tools.get(name);
    if (!def) throw new Error(`Ferramenta desconhecida: ${name}`);
    const parsed = def.schema.parse(args);
    return def.handler(parsed as Record<string, unknown>);
  }
}
