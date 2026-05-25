import pino from 'pino';
export class OntologyManager {
  private logger = pino();
  constructor(public tenantId: string) {}
  defineEntity(name: string, attributes: Record<string, unknown>): void {
    this.logger.info({ name }, 'Entity defined');
  }
}
export { OntologyManager as default };
