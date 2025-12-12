import PdfPrinter from 'pdfmake';
import { supabase } from "./functions.js";
import { TABLES } from "../config/tables.js";
import { storage } from "../config/firebase.js";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import fs from "fs";
import path from "path";
import { MINIMUM_PROJECT_COST } from './pricing.js';
const fonts = {
    Roboto: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique'
    }
};
const fontDescriptors = {
    Roboto: {
        normal: path.join(process.cwd(), 'fonts', 'Roboto-Regular.ttf'),
        bold: path.join(process.cwd(), 'fonts', 'Roboto-Medium.ttf'),
        italics: path.join(process.cwd(), 'fonts', 'Roboto-Italic.ttf'),
        bolditalics: path.join(process.cwd(), 'fonts', 'Roboto-MediumItalic.ttf')
    }
};
export async function generateQuotePDF(quoteId) {
    console.log(`Generating PDF (PDFMake) for Quote ID: ${quoteId}`);
    // 1. Fetch Quote Data
    const { data: quote, error: quoteError } = await supabase
        .from(TABLES.QUOTES)
        .select("*")
        .eq("id", quoteId)
        .single();
    if (quoteError || !quote) {
        throw new Error(`Quote not found: ${quoteError?.message}`);
    }
    // 2. Fetch Quote Lines
    const { data: lines, error: linesError } = await supabase
        .from(TABLES.QUOTE_LINES)
        .select("*")
        .eq("quote_id", quoteId)
        .order("created_at", { ascending: true });
    if (linesError || !lines) {
        throw new Error(`Error fetching lines: ${linesError?.message}`);
    }
    // 3. Group Data (Roll-up Logic)
    const parents = lines.filter((l) => !l.parent_line_id);
    const children = lines.filter((l) => l.parent_line_id);
    const itemsToPrint = parents.map((parent) => {
        const myChildren = children.filter((child) => child.parent_line_id === parent.id);
        const childrenTotal = myChildren.reduce((sum, child) => sum + child.subtotal, 0);
        const totalCost = childrenTotal > 0 ? childrenTotal : parent.subtotal;
        return {
            description: parent.description,
            scope: parent.scope_of_work || "",
            quantity: 1,
            unit: "Turnkey",
            unit_cost: totalCost,
            line_total: totalCost
        };
    });
    let grandTotal = itemsToPrint.reduce((sum, item) => sum + item.line_total, 0);
    // --- MINIMUM COST ADJUSTMENT ---
    if (grandTotal < MINIMUM_PROJECT_COST) {
        const adjustment = MINIMUM_PROJECT_COST - grandTotal;
        console.log(`[PDFGenerator] Grand Total ($${grandTotal}) is below minimum ($${MINIMUM_PROJECT_COST}). Adding adjustment of $${adjustment}.`);
        itemsToPrint.push({
            description: "Minimum Project Fee Adjustment",
            scope: "Adjustment to meet the minimum project requirement of $2,800.",
            quantity: 1,
            unit: "Fee",
            unit_cost: adjustment,
            line_total: adjustment
        });
        grandTotal = MINIMUM_PROJECT_COST;
    }
    // -------------------------------
    // Fetch Logo
    const logoUrl = 'https://firebasestorage.googleapis.com/v0/b/ultim-admin-dashboard.appspot.com/o/cemtech%2Flogo_cemtech.png?alt=media&token=443ea967-ac7f-4b81-b4b6-d1e4e7c7978b';
    let logoImage = null;
    try {
        const response = await fetch(logoUrl);
        if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            logoImage = `data:image/png;base64,${Buffer.from(arrayBuffer).toString('base64')}`;
        }
    }
    catch (e) {
        console.error("Failed to fetch logo:", e);
    }
    // 4. Build PDF Definition
    const colors = {
        primary: '#2C3E50',
        headerBg: '#F8F9FA',
        tableHeaderBg: '#337ab7', // Cemtech Blue-ish
        tableHeaderText: '#FFFFFF',
        zebraRow: '#F8F9FA',
        border: '#E0E0E0'
    };
    const docDefinition = {
        pageSize: 'A4',
        pageMargins: [40, 40, 40, 60],
        content: [
            // Header
            {
                columns: [
                    logoImage ? {
                        image: logoImage,
                        width: 150
                    } : {
                        // Logo placeholder (Text for now if no image)
                        text: 'CEMTECH',
                        fontSize: 20,
                        bold: true,
                        color: colors.primary,
                        width: 150
                    },
                    {
                        stack: [
                            { text: 'ESTIMATE', style: 'mainHeader', alignment: 'right' },
                            {
                                text: [
                                    { text: 'Estimate #: ', bold: true }, `${quoteId.slice(0, 8)}\n`,
                                    { text: 'Date: ', bold: true }, `${new Date().toLocaleDateString()}\n`,
                                ],
                                alignment: 'right',
                                style: 'headerInfo',
                                margin: [0, 5, 0, 0]
                            }
                        ],
                        width: '*'
                    }
                ],
                columnGap: 20,
                margin: [0, 0, 0, 30]
            },
            // Divider
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: colors.primary }], margin: [0, 0, 0, 20] },
            // Info Grid
            {
                columns: [
                    {
                        stack: [
                            { text: 'FROM', style: 'sectionLabel' },
                            { text: 'Cemtech Enterprise Inc.', style: 'companyName' },
                            { text: '2826 Springdale Rd.', style: 'normalText' },
                            { text: 'Snellville, GA 30039', style: 'normalText' },
                            { text: 'Email: Info@cemtechenterprise.com', style: 'normalText' },
                            { text: 'Phone: 678-749-6426', style: 'normalText' }
                        ]
                    },
                    {
                        stack: [
                            { text: 'FOR', style: 'sectionLabel' },
                            { text: quote.client_number || 'Valued Client', style: 'clientName' },
                            { text: quote.project_name || 'Project', style: 'normalText' }
                        ]
                    }
                ],
                columnGap: 40,
                margin: [0, 0, 0, 40]
            },
            // Items Table
            {
                table: {
                    headerRows: 1,
                    widths: ['*', 'auto', 'auto', 'auto', 'auto'],
                    body: [
                        [
                            { text: 'DESCRIPTION', style: 'tableHeader', fillColor: colors.tableHeaderBg },
                            { text: 'QTY', style: 'tableHeader', alignment: 'center', fillColor: colors.tableHeaderBg },
                            { text: 'UNIT', style: 'tableHeader', alignment: 'center', fillColor: colors.tableHeaderBg },
                            { text: 'PRICE', style: 'tableHeader', alignment: 'right', fillColor: colors.tableHeaderBg },
                            { text: 'TOTAL', style: 'tableHeader', alignment: 'right', fillColor: colors.tableHeaderBg }
                        ],
                        ...itemsToPrint.map((item, index) => {
                            // Description cell with Scope of Work
                            const descContent = [
                                { text: item.description, bold: true },
                                item.scope ? { text: `\n${item.scope}`, fontSize: 9, color: '#555', margin: [0, 5, 0, 0] } : ''
                            ];
                            return [
                                {
                                    stack: descContent,
                                    style: 'tableCell',
                                    fillColor: index % 2 === 1 ? colors.zebraRow : null,
                                    borderColor: colors.border
                                },
                                {
                                    text: item.quantity.toString(),
                                    style: 'tableCell',
                                    alignment: 'center',
                                    fillColor: index % 2 === 1 ? colors.zebraRow : null,
                                    borderColor: colors.border
                                },
                                {
                                    text: item.unit,
                                    style: 'tableCell',
                                    alignment: 'center',
                                    fillColor: index % 2 === 1 ? colors.zebraRow : null,
                                    borderColor: colors.border
                                },
                                {
                                    text: `$${item.unit_cost.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                                    style: 'tableCell',
                                    alignment: 'right',
                                    fillColor: index % 2 === 1 ? colors.zebraRow : null,
                                    borderColor: colors.border
                                },
                                {
                                    text: `$${item.line_total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                                    style: 'tableCell',
                                    alignment: 'right',
                                    fillColor: index % 2 === 1 ? colors.zebraRow : null,
                                    borderColor: colors.border
                                }
                            ];
                        })
                    ]
                },
                layout: {
                    hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 1 : 1,
                    vLineWidth: () => 0,
                    hLineColor: () => colors.border
                }
            },
            // Totals
            {
                columns: [
                    { width: '*', text: '' },
                    {
                        width: 200,
                        table: {
                            widths: ['*', 'auto'],
                            body: [
                                [
                                    { text: 'Total:', style: 'grandTotalLabel', alignment: 'right', margin: [0, 10, 0, 0] },
                                    { text: `$${grandTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, style: 'grandTotalValue', alignment: 'right', margin: [0, 10, 0, 0] }
                                ]
                            ]
                        },
                        layout: 'noBorders'
                    }
                ],
                margin: [0, 20, 0, 0]
            },
            // Footer
            {
                text: 'Thank you for your business!',
                style: 'footerMessage',
                alignment: 'center',
                margin: [0, 50, 0, 0]
            }
        ],
        styles: {
            mainHeader: { fontSize: 24, bold: true, color: colors.primary },
            headerInfo: { fontSize: 10, color: '#555555' },
            sectionLabel: { fontSize: 10, bold: true, color: '#999999', margin: [0, 0, 0, 5] },
            companyName: { fontSize: 12, bold: true, color: '#333333' },
            clientName: { fontSize: 12, bold: true, color: '#333333' },
            normalText: { fontSize: 10, color: '#555555' },
            tableHeader: { bold: true, fontSize: 10, color: colors.tableHeaderText, margin: [5, 8, 5, 8] },
            tableCell: { fontSize: 10, color: '#333333', margin: [5, 8, 5, 8] },
            grandTotalLabel: { fontSize: 14, bold: true, color: colors.primary },
            grandTotalValue: { fontSize: 14, bold: true, color: colors.primary },
            footerMessage: { fontSize: 12, italics: true, color: '#777777' }
        },
        defaultStyle: {
            font: 'Roboto'
        }
    };
    // 5. Generate PDF
    // We need to handle the font issue. If files don't exist, we'll try to download them or fail gracefully.
    // For this environment, I'll assume we need to download them.
    await ensureFontsExist();
    const printer = new PdfPrinter(fontDescriptors);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const pdfBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        pdfDoc.on('data', (chunk) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err) => reject(err));
        pdfDoc.end();
    });
    // 6. Upload to Firebase
    const fileName = `quote_${quoteId}_${Date.now()}.pdf`;
    const storageRef = ref(storage, `quotes/${fileName}`);
    try {
        console.log("Uploading PDF to Firebase Storage...");
        const metadata = {
            contentType: 'application/pdf',
        };
        await uploadBytes(storageRef, pdfBuffer, metadata);
        const publicUrl = await getDownloadURL(storageRef);
        console.log("PDF uploaded successfully:", publicUrl);
        // 7. Update Quote in Supabase with the PDF URL
        const { error: updateError } = await supabase
            .from(TABLES.QUOTES)
            .update({ pdf_url: publicUrl })
            .eq("id", quoteId);
        if (updateError) {
            console.error("Error updating quote record with PDF URL:", updateError);
        }
        return publicUrl;
    }
    catch (err) {
        console.error("Failed to upload PDF to Firebase:", err);
        // Fallback to local save if firebase fails
        console.log("Saving locally as fallback.");
        const localDir = path.join(process.cwd(), "public", "quotes");
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }
        const localPath = path.join(localDir, fileName);
        fs.writeFileSync(localPath, pdfBuffer);
        return `PDF saved locally: ${localPath}`;
    }
}
// Helper to download fonts if missing (Basic implementation)
async function ensureFontsExist() {
    const fontDir = path.join(process.cwd(), 'fonts');
    if (!fs.existsSync(fontDir)) {
        fs.mkdirSync(fontDir, { recursive: true });
    }
    const fontFiles = {
        'Roboto-Regular.ttf': 'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Regular.ttf',
        'Roboto-Medium.ttf': 'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Medium.ttf',
        'Roboto-Italic.ttf': 'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-Italic.ttf',
        'Roboto-MediumItalic.ttf': 'https://github.com/google/fonts/raw/main/apache/roboto/Roboto-MediumItalic.ttf'
    };
    for (const [file, url] of Object.entries(fontFiles)) {
        const filePath = path.join(fontDir, file);
        if (!fs.existsSync(filePath)) {
            console.log(`Downloading font: ${file}...`);
            try {
                const response = await fetch(url);
                if (!response.ok)
                    throw new Error(`Failed to fetch ${url}`);
                const arrayBuffer = await response.arrayBuffer();
                fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
            }
            catch (e) {
                console.error(`Error downloading font ${file}:`, e);
                // Fallback: Create empty file to prevent crash loop, but PDF generation might fail visually
                // fs.writeFileSync(filePath, Buffer.alloc(0)); 
            }
        }
    }
}
