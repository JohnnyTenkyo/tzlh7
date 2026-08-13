import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { scanJobs } from "../drizzle/schema";

describe("scan_jobs schema", () => {
  it("defines the persistent scan task table required by the scanner", () => {
    expect(getTableName(scanJobs)).toBe("scan_jobs");

    const columns = getTableColumns(scanJobs);
    expect(Object.keys(columns)).toEqual(expect.arrayContaining([
      "id",
      "userId",
      "status",
      "progress",
      "total",
      "strategies",
      "message",
      "resultCount",
      "createdAt",
    ]));
  });

  it("supports cancelled jobs so an active scan can be stopped safely", () => {
    const columns = getTableColumns(scanJobs);
    expect((columns.status as any).enumValues).toContain("cancelled");
  });
});
