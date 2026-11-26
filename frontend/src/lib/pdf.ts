// สร้างไฟล์ PDF จากตารางที่แสดงบนหน้าเว็บ (จับภาพทีละตาราง หน้าละ 1 ตาราง แนวนอน A4)
// ใช้การจับภาพเพื่อให้ภาษาไทยแสดงถูกต้องเหมือนบนจอ

export async function elementsToPdf(
  elements: HTMLElement[],
  filename: string,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
) {
  const [{ jsPDF }, html2canvas] = await Promise.all([import("jspdf"), import("html2canvas-pro").then((m) => m.default)]);
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  for (let i = 0; i < elements.length; i++) {
    if (shouldStop?.()) throw new Error("ยกเลิกแล้ว");
    const canvas = await html2canvas(elements[i], { scale: 2, backgroundColor: "#ffffff", logging: false });
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const ratio = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    if (i > 0) pdf.addPage("a4", "landscape");
    pdf.addImage(img, "JPEG", (pageW - w) / 2, margin, w, h);
    onProgress?.(i + 1, elements.length);
  }
  pdf.save(filename);
}
