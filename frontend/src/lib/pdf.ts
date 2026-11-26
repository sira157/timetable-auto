// สร้างไฟล์ PDF จากตารางที่แสดงบนหน้าเว็บ (A4 แนวนอน)
// ใช้การจับภาพเพื่อให้ภาษาไทยแสดงถูกต้องเหมือนบนจอ
// แต่ละส่วนที่มี data-pdf-new="1" เริ่มหน้าใหม่ ส่วนอื่นวางต่อใต้ส่วนก่อนหน้าถ้าที่พอ
// ปรับขนาดให้เต็มความกว้างหน้ากระดาษก่อน ถ้าสูงเกินหน้าจึงย่อให้พอดีหน้า

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
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;
  let y = margin;
  let first = true;
  for (let i = 0; i < elements.length; i++) {
    if (shouldStop?.()) throw new Error("ยกเลิกแล้ว");
    const el = elements[i];
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", logging: false });
    const img = canvas.toDataURL("image/jpeg", 0.85);
    let ratio = usableW / canvas.width;
    if (canvas.height * ratio > usableH) ratio = usableH / canvas.height;
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    const newPage = el.dataset.pdfNew === "1";
    if (first) {
      first = false;
    } else if (newPage || y + h > pageH - margin) {
      pdf.addPage("a4", "landscape");
      y = margin;
    }
    pdf.addImage(img, "JPEG", (pageW - w) / 2, y, w, h);
    y += h + 3;
    onProgress?.(i + 1, elements.length);
  }
  pdf.save(filename);
}
