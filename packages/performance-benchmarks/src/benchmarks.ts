import pino from 'pino';
import { generateId } from '@neurostack/shared';
import { MLAnomalyDetector, DataPoint } from '@neurostack/ml-anomaly-detector';
import { ProphetModel, LSTMModel, TimeSeriesDataPoint } from '@neurostack/advanced-ml';
import { ModelServingEngine } from '@neurostack/model-serving';
import { MetricsAggregation } from '@neurostack/metrics-aggregation';
import { AlertOptimization } from '@neurostack/alert-optimization';
import { RecommendationEngine } from '@neurostack/dashboard-recommendations';

/**
 * Performance Benchmark Types
 */

export interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number; // milliseconds
  averageTime: number;
  minTime: number;
  maxTime: number;
  stdDev: number;
  throughput: number; // ops per second
  passed: boolean;
  target?: number;
  message: string;
}

export interface BenchmarkSuite {
  name: string;
  timestamp: Date;
  results: BenchmarkResult[];
  totalTime: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
}

/**
 * Performance Benchmarking Suite
 *
 * Comprehensive performance testing for all Intelligence Layer components
 */
export class PerformanceBenchmarks {
  private logger = pino();
  private results: BenchmarkResult[] = [];

  constructor() {}

  /**
   * Run all benchmarks
   */
  async runAll(): Promise<BenchmarkSuite> {
    const suiteStart = Date.now();
    const timestamp = new Date();

    this.logger.info('Starting comprehensive benchmark suite');

    // Run individual benchmark suites
    await this.benchmarkAnomalyDetection();
    await this.benchmarkAdvancedML();
    await this.benchmarkModelServing();
    await this.benchmarkMetricsAggregation();
    await this.benchmarkAlertOptimization();
    await this.benchmarkRecommendations();

    const totalTime = Date.now() - suiteStart;
    const passedTests = this.results.filter((r) => r.passed).length;
    const failedTests = this.results.filter((r) => !r.passed).length;

    const suite: BenchmarkSuite = {
      name: 'Phase 2.4 Intelligence Layer Benchmarks',
      timestamp,
      results: this.results,
      totalTime,
      passedTests,
      failedTests,
      successRate: this.results.length > 0 ? (passedTests / this.results.length) * 100 : 0,
    };

    return suite;
  }

  /**
   * Benchmark anomaly detection
   */
  private async benchmarkAnomalyDetection(): Promise<void> {
    this.logger.info('Benchmarking anomaly detection...');

    const detector = new MLAnomalyDetector();

    // Generate test data
    const testData: DataPoint[] = this.generateTimeSeriesData(1000);

    // Warmup
    detector.detectAnomalies(testData);

    // Benchmark
    const iterations = 100;
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      detector.detectAnomalies(testData);
      times.push(Date.now() - start);
    }

    const result = this.calculateStats('Anomaly Detection', iterations, times, 50); // 50ms target
    this.results.push(result);
  }

  /**
   * Benchmark advanced ML models
   */
  private async benchmarkAdvancedML(): Promise<void> {
    this.logger.info('Benchmarking advanced ML models...');

    const historicalData: TimeSeriesDataPoint[] = this.generateTimeSeriesDataAdvanced(500);

    // Prophet Model
    const prophet = new ProphetModel(historicalData);
    prophet.fit();

    const prophetTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      prophet.forecast(7);
      prophetTimes.push(Date.now() - start);
    }

    const prophetResult = this.calculateStats('Prophet Forecasting', 100, prophetTimes, 30);
    this.results.push(prophetResult);

    // LSTM Model
    const lstm = new LSTMModel(historicalData, 10);
    lstm.fit();

    const lstmTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      lstm.predict(7);
      lstmTimes.push(Date.now() - start);
    }

    const lstmResult = this.calculateStats('LSTM Prediction', 100, lstmTimes, 30);
    this.results.push(lstmResult);

    // Decomposition
    const decompTimes: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = Date.now();
      prophet.getDecomposition();
      decompTimes.push(Date.now() - start);
    }

    const decompResult = this.calculateStats('Time Series Decomposition', 50, decompTimes, 20);
    this.results.push(decompResult);
  }

  /**
   * Benchmark model serving
   */
  private async benchmarkModelServing(): Promise<void> {
    this.logger.info('Benchmarking model serving...');

    const serving = new ModelServingEngine();
    const historicalData = this.generateTimeSeriesDataAdvanced(100);

    const prophet = new ProphetModel(historicalData);
    prophet.fit();
    serving.registerModel('prophet-1', 'prophet', prophet, '1.0.0');

    // Single inference
    const singleTimes: number[] = [];
    for (let i = 0; i < 200; i++) {
      const start = Date.now();
      await serving.inference({
        requestId: generateId(),
        modelType: 'prophet',
        modelId: 'prophet-1',
        data: historicalData,
        parameters: { periods: 7 },
        timestamp: new Date(),
        priority: 'normal',
      });
      singleTimes.push(Date.now() - start);
    }

    const singleResult = this.calculateStats('Single Inference', 200, singleTimes, 50);
    this.results.push(singleResult);

    // Batch inference
    const batchTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
      const requests = Array.from({ length: 32 }, () => ({
        requestId: generateId(),
        modelType: 'prophet' as const,
        modelId: 'prophet-1',
        data: historicalData,
        parameters: { periods: 7 },
        timestamp: new Date(),
        priority: 'normal' as const,
      }));

      const start = Date.now();
      await serving.batchInference({
        batchId: generateId(),
        requests,
        timeout: 5000,
      });
      batchTimes.push(Date.now() - start);
    }

    const batchResult = this.calculateStats('Batch Inference (32)', 20, batchTimes, 100);
    this.results.push(batchResult);

    // Cache performance
    const cacheStats = serving.getCacheStats();
    this.logger.info({ cacheStats }, 'Cache statistics');
  }

  /**
   * Benchmark metrics aggregation
   */
  private async benchmarkMetricsAggregation(): Promise<void> {
    this.logger.info('Benchmarking metrics aggregation...');

    const metrics = new MetricsAggregation();

    // Recording metrics
    const recordTimes: number[] = [];
    for (let i = 0; i < 10000; i++) {
      const start = Date.now();
      metrics.recordMetric(`metric-${i % 100}`, Math.random() * 100);
      recordTimes.push(Date.now() - start);
    }

    const recordResult = this.calculateStats('Metric Recording', 10000, recordTimes, 1);
    this.results.push(recordResult);

    // Aggregation
    const aggregateTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      metrics.aggregate(`metric-${i}`, 60000);
      aggregateTimes.push(Date.now() - start);
    }

    const aggregateResult = this.calculateStats('Metric Aggregation (1min)', 100, aggregateTimes, 10);
    this.results.push(aggregateResult);

    // Percentile calculation
    const percentileTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      metrics.getPercentile(`metric-${i}`, 95, 60000);
      percentileTimes.push(Date.now() - start);
    }

    const percentileResult = this.calculateStats('Percentile Calculation', 100, percentileTimes, 5);
    this.results.push(percentileResult);

    // System health check
    const healthTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      metrics.getSystemHealth();
      healthTimes.push(Date.now() - start);
    }

    const healthResult = this.calculateStats('System Health Score', 100, healthTimes, 2);
    this.results.push(healthResult);
  }

  /**
   * Benchmark alert optimization
   */
  private async benchmarkAlertOptimization(): Promise<void> {
    this.logger.info('Benchmarking alert optimization...');

    const optimization = new AlertOptimization();

    // Record alert results to build history
    for (let i = 0; i < 500; i++) {
      optimization.recordAlertResult(`rule-${i % 10}`, Math.random() > 0.1, 'high', Math.random() * 5000);
    }

    // Analysis
    const analysisTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      optimization.analyzeRulePerformance(`rule-${i}`);
      analysisTimes.push(Date.now() - start);
    }

    const analysisResult = this.calculateStats('Rule Performance Analysis', 10, analysisTimes, 50);
    this.results.push(analysisResult);

    // Optimization
    const optimizationTimes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = Date.now();
      optimization.optimizeAllRules();
      optimizationTimes.push(Date.now() - start);
    }

    const optimizationResult = this.calculateStats('Full Optimization Sweep', 10, optimizationTimes, 200);
    this.results.push(optimizationResult);
  }

  /**
   * Benchmark recommendations
   */
  private async benchmarkRecommendations(): Promise<void> {
    this.logger.info('Benchmarking recommendations...');

    const recommendations = new RecommendationEngine();

    // Generate user interactions
    const userCount = 100;
    const widgetTypes = ['MetricCard', 'LineChart', 'BarChart', 'PieChart', 'Table'];

    for (let i = 0; i < 5000; i++) {
      const userId = `user-${i % userCount}`;
      const widgetType = widgetTypes[Math.floor(Math.random() * widgetTypes.length)];
      recommendations.recordInteraction({
        widgetId: generateId(),
        widgetType,
        userId,
        action: 'view',
        timestamp: new Date(),
        duration: Math.random() * 30000,
      });
    }

    // Generate recommendations
    const recommendationTimes: number[] = [];
    for (let i = 0; i < 100; i++) {
      const start = Date.now();
      recommendations.generateRecommendations(`user-${i % userCount}`);
      recommendationTimes.push(Date.now() - start);
    }

    const recommendationResult = this.calculateStats(
      'Recommendation Generation',
      100,
      recommendationTimes,
      50
    );
    this.results.push(recommendationResult);

    // Popularity analysis
    const popularityTimes: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = Date.now();
      recommendations.getWidgetPopularity();
      popularityTimes.push(Date.now() - start);
    }

    const popularityResult = this.calculateStats('Widget Popularity Analysis', 50, popularityTimes, 5);
    this.results.push(popularityResult);
  }

  // Helper methods

  private generateTimeSeriesData(count: number): DataPoint[] {
    const data: DataPoint[] = [];
    for (let i = 0; i < count; i++) {
      data.push({
        timestamp: new Date(Date.now() - (count - i) * 60000),
        value: Math.sin((i / count) * 2 * Math.PI) * 10 + Math.random() * 5 + 50,
      });
    }
    return data;
  }

  private generateTimeSeriesDataAdvanced(count: number): TimeSeriesDataPoint[] {
    const data: TimeSeriesDataPoint[] = [];
    for (let i = 0; i < count; i++) {
      data.push({
        timestamp: new Date(Date.now() - (count - i) * 60000),
        value: Math.sin((i / count) * 2 * Math.PI) * 10 + Math.random() * 5 + 50,
        seasonalFactor: Math.sin((i / 7) * 2 * Math.PI),
        trendComponent: i / count,
      });
    }
    return data;
  }

  private calculateStats(
    name: string,
    iterations: number,
    times: number[],
    target?: number
  ): BenchmarkResult {
    const sorted = times.sort((a, b) => a - b);
    const totalTime = times.reduce((a, b) => a + b, 0);
    const averageTime = totalTime / iterations;
    const minTime = sorted[0];
    const maxTime = sorted[sorted.length - 1];

    const variance = times.reduce((sum, t) => sum + Math.pow(t - averageTime, 2), 0) / iterations;
    const stdDev = Math.sqrt(variance);

    const throughput = (1000 / averageTime) * (averageTime > 0 ? 1 : 0);

    const passed = target ? averageTime <= target : true;

    const message = passed
      ? `✅ PASS (${averageTime.toFixed(2)}ms avg, target ${target || 'N/A'}ms)`
      : `❌ FAIL (${averageTime.toFixed(2)}ms avg, target ${target}ms)`;

    return {
      name,
      iterations,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      stdDev,
      throughput,
      passed,
      target,
      message,
    };
  }

  /**
   * Print benchmark results
   */
  printResults(suite: BenchmarkSuite): void {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║       Performance Benchmark Results - Phase 2.4            ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log(`Suite: ${suite.name}`);
    console.log(`Timestamp: ${suite.timestamp.toISOString()}`);
    console.log(`Total Time: ${(suite.totalTime / 1000).toFixed(2)}s`);
    console.log(`Success Rate: ${suite.successRate.toFixed(1)}% (${suite.passedTests}/${suite.results.length} passed)\n`);

    console.log('┌─────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
    console.log('│ Test Name           │ Avg(ms)  │ Min(ms)  │ Max(ms)  │ StdDev   │ Status   │');
    console.log('├─────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');

    for (const result of suite.results) {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(
        `│ ${result.name.padEnd(19)} │ ${result.averageTime.toFixed(2).padStart(8)} │ ${result.minTime
          .toFixed(2)
          .padStart(8)} │ ${result.maxTime
          .toFixed(2)
          .padStart(8)} │ ${result.stdDev.toFixed(2).padStart(8)} │ ${status.padStart(8)} │`
      );
    }

    console.log('└─────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘\n');

    const failedTests = suite.results.filter((r) => !r.passed);
    if (failedTests.length > 0) {
      console.log('⚠️  Failed Tests:');
      for (const test of failedTests) {
        console.log(`   ${test.message}`);
      }
    } else {
      console.log('✅ All benchmarks passed!');
    }

    console.log('\n');
  }
}

export default PerformanceBenchmarks;
