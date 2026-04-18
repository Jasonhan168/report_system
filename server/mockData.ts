// Mock 数据生成器 - 封装厂WIP汇总表

export interface WipRecord {
  label_name: string;
  vendor_part_no: string;
  vendor_name: string;
  unissued_qty: number;
  open_qty: number;  // 未回货数量（来自委外订单）
  die_attach: number;
  wire_bond: number;
  molding: number;
  testing: number;
  test_done: number;
  wip_qty: number;
}

const LABEL_NAMES = [
  "XC7A35T-1FTG256C", "XC7A50T-2FGG484I", "XC7K160T-2FFG676I",
  "XC7Z020-1CLG400C", "XC7Z045-2FFG900I", "XC6SLX9-2TQG144C",
  "EP4CE6E22C8N", "EP4CE10F17C8N", "EP4CE22F17C8N",
  "5CEBA4F23C8N", "5CGXFC7D6F31C7N", "10M08SAE144C8G",
  "GW1N-LV4LQ144C6/I5", "GW1N-LV9LQ144C6/I5", "GW2A-LV18PG256C8/I7",
];

const VENDOR_NAMES = [
  "深圳华威封装", "苏州精工封装", "成都天府封装",
  "武汉光谷封装", "西安高新封装", "重庆两江封装",
];

const VENDOR_PART_PREFIXES: Record<string, string> = {
  "深圳华威封装": "HW",
  "苏州精工封装": "JG",
  "成都天府封装": "TF",
  "武汉光谷封装": "GG",
  "西安高新封装": "GX",
  "重庆两江封装": "LJ",
};

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateVendorPartNo(vendorName: string, labelName: string): string {
  const prefix = VENDOR_PART_PREFIXES[vendorName] || "XX";
  const suffix = labelName.replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase();
  return `${prefix}-${suffix}`;
}

export function generateMockWipData(params: {
  date: string;
  labelName?: string;
  vendorName?: string;
  page?: number;
  pageSize?: number;
}): { data: WipRecord[]; total: number; totalRow: WipRecord } {
  const { date, labelName, vendorName, page = 1, pageSize = 20 } = params;

  const dateNum = parseInt(date.replace(/-/g, ""), 10) || 20240101;
  const rand = seededRandom(dateNum);

  let allData: WipRecord[] = [];
  for (const label of LABEL_NAMES) {
    const vendorCount = Math.floor(rand() * 3) + 1;
    const shuffledVendors = [...VENDOR_NAMES].sort(() => rand() - 0.5).slice(0, vendorCount);

    for (const vendor of shuffledVendors) {
      const baseQty = Math.floor(rand() * 5000) + 500;
      const dieAttach = Math.floor(rand() * baseQty * 0.3);
      const wireBond = Math.floor(rand() * (baseQty - dieAttach) * 0.4);
      const molding = Math.floor(rand() * (baseQty - dieAttach - wireBond) * 0.5);
      const testing = Math.floor(rand() * (baseQty - dieAttach - wireBond - molding) * 0.6);
      const testDone = Math.floor(rand() * (baseQty - dieAttach - wireBond - molding - testing) * 0.7);
      const wipQty = dieAttach + wireBond + molding + testing + testDone;
      const unissuedQty = Math.max(0, baseQty - wipQty - Math.floor(rand() * 200));

      const openQty = Math.floor(rand() * baseQty * 0.2); // 模拟未回货数量
      allData.push({
        label_name: label,
        vendor_part_no: generateVendorPartNo(vendor, label),
        vendor_name: vendor,
        unissued_qty: unissuedQty,
        open_qty: openQty,
        die_attach: dieAttach,
        wire_bond: wireBond,
        molding: molding,
        testing: testing,
        test_done: testDone,
        wip_qty: wipQty,
      });
    }
  }

  if (labelName) {
    allData = allData.filter((r) =>
      r.label_name.toLowerCase().includes(labelName.toLowerCase())
    );
  }
  if (vendorName) {
    allData = allData.filter((r) =>
      r.vendor_name.toLowerCase().includes(vendorName.toLowerCase())
    );
  }

  const total = allData.length;

  const totalRow: WipRecord = {
    label_name: "合计",
    vendor_part_no: "",
    vendor_name: "",
    unissued_qty: allData.reduce((s, r) => s + r.unissued_qty, 0),
    open_qty: allData.reduce((s, r) => s + r.open_qty, 0),
    die_attach: allData.reduce((s, r) => s + r.die_attach, 0),
    wire_bond: allData.reduce((s, r) => s + r.wire_bond, 0),
    molding: allData.reduce((s, r) => s + r.molding, 0),
    testing: allData.reduce((s, r) => s + r.testing, 0),
    test_done: allData.reduce((s, r) => s + r.test_done, 0),
    wip_qty: allData.reduce((s, r) => s + r.wip_qty, 0),
  };

  const start = (page - 1) * pageSize;
  const data = allData.slice(start, start + pageSize);

  return { data, total, totalRow };
}

export function generateMockFilterOptions(date: string) {
  const dateNum = parseInt(date.replace(/-/g, ""), 10) || 20240101;
  const rand = seededRandom(dateNum);

  const labelNames = [...LABEL_NAMES].sort(() => rand() - 0.5);
  const vendorNames = [...VENDOR_NAMES];

  return { labelNames, vendorNames };
}
