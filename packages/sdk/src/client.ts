export class NeuroStackClient {
  constructor(private baseUrl: string, private apiKey: string) {}
  async executeQuery(query: string): Promise<any> {
    return { success: true, data: [] };
  }
}
