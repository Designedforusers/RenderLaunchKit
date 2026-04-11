// Type declaration for the `google-trends-api` npm package.
//
// The package ships as CommonJS and exports a single object via
// `module.exports = { interestOverTime, relatedQueries, ... }`. The
// `export =` syntax below is the TypeScript-sanctioned way to
// declare a CJS default export — combined with `esModuleInterop: true`
// in `tsconfig.base.json`, it lets callers use `await import(...)`
// and read the API off `.default` without any cast. A `declare
// function` style (named top-level exports) would NOT reflect the
// runtime shape and would force a boundary cast at every call site.
declare module 'google-trends-api' {
  interface TrendsOptions {
    keyword?: string;
    startTime?: Date;
    endTime?: Date;
    geo?: string;
    hl?: string;
    category?: number;
  }

  interface GoogleTrendsApi {
    interestOverTime(options: TrendsOptions): Promise<string>;
    relatedQueries(options: TrendsOptions): Promise<string>;
    relatedTopics(options: TrendsOptions): Promise<string>;
    dailyTrends(options: TrendsOptions): Promise<string>;
    realTimeTrends(options: TrendsOptions): Promise<string>;
    autoComplete(options: TrendsOptions): Promise<string>;
    interestByRegion(options: TrendsOptions): Promise<string>;
  }

  const googleTrendsApi: GoogleTrendsApi;
  export = googleTrendsApi;
}
