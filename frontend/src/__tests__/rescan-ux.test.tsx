import { act, render, renderHook, screen } from "@testing-library/react";
import { LastScan } from "@/components/ui/last-scan";
import { useThrottled } from "@/lib/use-throttled";

describe("useThrottled", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("passes a burst of changes through as one update per interval, ending on the latest value", () => {
    const { result, rerender } = renderHook(({ value }) => useThrottled(value, 1000), { initialProps: { value: 0 } });

    rerender({ value: 1 });
    act(() => jest.advanceTimersByTime(0));
    expect(result.current).toBe(1); // the first change goes through at once

    for (let v = 2; v <= 8; v++) {
      rerender({ value: v }); // 7 more scans finish within 700 ms
      act(() => jest.advanceTimersByTime(100));
    }
    expect(result.current).toBe(1); // ...held back inside the interval

    act(() => jest.advanceTimersByTime(300));
    expect(result.current).toBe(8); // one update with the latest value
  });
});

describe("LastScan", () => {
  it("shows why the last scan failed, since the risk shown is older", () => {
    render(<LastScan at={new Date().toISOString()} error="DNS_NOT_FOUND" />);
    expect(screen.getByText("Host not found")).toBeInTheDocument();
    expect(screen.getByTitle(/risk shown is from the last successful scan/)).toBeInTheDocument();
  });

  it("is just the time when the scan succeeded", () => {
    const { container } = render(<LastScan at={null} error={null} />);
    expect(container.textContent).toBe("never");
  });
});
