import { realFirst } from "@/lib/real-first";

const page = (ids: string[]) => ({ data: ids, meta: { page: 1, pageSize: 8, total: ids.length, totalPages: 1 } });

describe("realFirst", () => {
  it("lists real rows first and fills up with demo rows", () => {
    const result = realFirst({ data: page(["r1", "r2"]), error: null }, { data: page(["d1", "d2", "d3"]), error: null }, 4);
    expect(result).toEqual({ data: ["r1", "r2", "d1", "d2"], error: null });
  });

  it("shows only real rows when there are enough of them", () => {
    const real = page(["r1", "r2", "r3"]);
    expect(realFirst({ data: real, error: null }, { data: page(["d1"]), error: null }, 3).data).toEqual(["r1", "r2", "r3"]);
  });

  it("waits for both lists, and reports an error from either", () => {
    expect(realFirst({ data: page(["r1"]), error: null }, { data: null, error: null }).data).toBeNull();
    expect(realFirst({ data: null, error: "boom" }, { data: page([]), error: null }).error).toBe("boom");
  });
});
