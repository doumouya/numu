/* chart-theme.ts — token → ECharts synthesis for the console's chart tiles.
   Options carry EXPLICIT colors read from the live token closure at render
   time (--chart-1..8 + the structural aliases), so a chart always renders the
   current theme × mode; on a theme switch app.ts re-renders the chart-bearing
   regions, rebuilding options against the freshly resolved tokens. No literal
   colors live here (css-drift-audit C1) — an unresolved token falls through to
   the ECharts default, and C3 guarantees the closure resolves anyway.

   Charts init DIRECTLY on a .nu- slot (mountNuChart): amenan's mountChart is a
   chrome-carrying card, and restyling its .amu-chart-* internals from app.css
   would break single-CSS-ownership — the console owns its tile chrome. */

function tok(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function palette(): string[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => tok(`--chart-${i}`)).filter(Boolean);
}

/** An ECharts option for one console chart spec ({type, cats}). Covers the
    console vocabulary: bar (default) · donut/pie · line/area. */
export function chartOption(spec: NumuChartSpec): Record<string, unknown> {
  const colors = palette();
  const axis = tok("--chart-axis");
  const grid = tok("--chart-grid");
  const tooltip = {
    backgroundColor: tok("--chart-tooltip-bg"),
    borderColor: tok("--chart-tooltip-border"),
    textStyle: { color: tok("--chart-tooltip-text") },
  };
  const labels = spec.cats.map((c) => c.label);
  const values = spec.cats.map((c) => c.value);
  const kind = spec.type.toLowerCase();

  if (kind === "donut" || kind === "pie") {
    return {
      color: colors,
      tooltip: { trigger: "item", ...tooltip },
      series: [
        {
          type: "pie",
          radius: kind === "donut" ? ["55%", "82%"] : "78%",
          data: spec.cats.map((c) => ({ name: c.label, value: c.value })),
          label: { color: axis, fontSize: 10 },
          itemStyle: { borderWidth: 0 },
        },
      ],
    };
  }

  const isLine = kind === "line" || kind === "area";
  return {
    color: colors,
    tooltip: { trigger: "axis", ...tooltip },
    grid: { left: 6, right: 8, top: 12, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisLine: { lineStyle: { color: grid } },
      axisLabel: { color: axis, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: grid } },
      axisLabel: { color: axis, fontSize: 10 },
    },
    series: [
      {
        type: isLine ? "line" : "bar",
        data: values,
        smooth: isLine,
        areaStyle: kind === "area" ? {} : undefined,
        barMaxWidth: 26,
        itemStyle: { borderRadius: isLine ? 0 : [3, 3, 0, 0] },
      },
    ],
  };
}

/** Init an ECharts instance on a console-owned slot. Wires a window resize;
    the region re-render on theme change disposes it (destroy). Graceful with
    no echarts on the page (renders nothing, never throws). */
export function mountNuChart(slot: HTMLElement, spec: NumuChartSpec): { destroy(): void } {
  const echarts = window.echarts;
  if (!echarts) return { destroy() {} };
  try {
    const chart = echarts.init(slot);
    chart.setOption(chartOption(spec));
    const onResize = (): void => chart.resize();
    window.addEventListener("resize", onResize);
    return {
      destroy() {
        window.removeEventListener("resize", onResize);
        chart.dispose();
      },
    };
  } catch {
    return { destroy() {} };
  }
}
