/**
 * Interface de repositório para análises.
 *
 * O `AnalysisRepository` é o contrato usado pelos serviços. Ele NÃO conhece o
 * store (SQLite) nem o domínio de negócio além de `Analysis`. Isso permite:
 *   - trocar o backend de persistência sem tocar no motor (multi-tenancy-ready);
 *   - adicionar `workspace_id` futuramente sem reescrever o motor quantitativo.
 */
import type { Analysis } from "../../domain/types";

export interface ListAnalysisFilter {
  readonly symbol?: string;
  readonly timeframe?: string;
  readonly from?: number;
  readonly to?: number;
  readonly limit?: number;
}

export interface AnalysisRepository {
  save(analysis: Analysis): Promise<void>;
  findById(id: string): Promise<Analysis | null>;
  list(filter?: ListAnalysisFilter): Promise<Analysis[]>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}
