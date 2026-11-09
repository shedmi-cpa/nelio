/**
 * Nelio · naming lab · stage 3.2. Temporary: delete this file when stage 3.2 closes.
 *
 * namingLab() creates sample client folders and files in Drive, named in two ways, so we can
 * see how Hebrew names really look before choosing: in Drive on the computer, in the Drive app
 * on the phone, and inside a downloaded ZIP. Run it from the Apps Script editor: choose
 * namingLab in the list of functions, then Run. Running it again moves the previous lab to the
 * trash and creates a fresh one.
 *
 *   A  date first (the proposal in decisions.md):  2026-10_מאפיית-השקד_דף-בנק_01.jpg
 *   B  business name first:                       מאפיית-השקד_2026-10_דף-בנק_01.jpg
 *
 * All the names are invented test data. Every file is a tiny image (or PDF) marked "לדוגמה".
 */

const LAB_FOLDER_NAME = 'בדיקת שמות – שלב 3.2';

// Each file: [scheme, document label, number].
const LAB_CLIENTS = [
  {
    id: 'T1', name: 'מאפיית השקד', period: '2026-10',
    files: [
      ['A', 'דף-בנק', 1], ['A', 'דף-בנק', 2],
      ['B', 'דף-בנק', 1], ['B', 'דף-בנק', 2],
      ['B', 'דוחות-Z', 1],   // a Latin letter inside a Hebrew name
      ['B', 'דוחות-זד', 1],  // the same document, in Hebrew letters only
    ],
    rejected: ['B', 'דף-בנק', 3],  // a rejected file, in a "נדחו" folder inside the month
  },
  {
    id: 'T2', name: 'ג\'ו שיפוצים בע"מ', period: '2026-10', pdf: true,  // ' and " in the name
    files: [['A', 'חשבוניות-ספקים', 1], ['B', 'חשבוניות-ספקים', 1]],
  },
  {
    id: 'T3', name: 'Pixel – צילום אירועים', period: '2026-10',  // starts in English
    files: [['A', 'קבלות-הוצאות', 1], ['B', 'קבלות-הוצאות', 1]],
  },
  {
    id: 'T4', name: '24/7 מיזוג אוויר', period: '2026-09_10',  // a slash, and a bimonthly client
    files: [['A', 'קבלות-דלק', 1], ['B', 'קבלות-דלק', 1]],
  },
];

function namingLab() {
  assertOfficeAccount_();
  const root = ensureRootFolder_();

  const previous = root.getFoldersByName(LAB_FOLDER_NAME);
  while (previous.hasNext()) previous.next().setTrashed(true);
  const lab = root.createFolder(LAB_FOLDER_NAME);

  const created = [];
  LAB_CLIENTS.forEach(function (client) {
    const clientFolder = lab.createFolder(cleanFolderName_(client.name) + ' (' + client.id + ')');
    const monthFolder = clientFolder.createFolder(client.period);
    const path = clientFolder.getName() + ' / ' + client.period + ' / ';
    client.files.forEach(function (spec) {
      created.push(spec[0] + '   ' + path + addLabFile_(monthFolder, client, spec));
    });
    if (client.rejected) {
      const rejectedFolder = monthFolder.createFolder('נדחו');
      created.push(client.rejected[0] + '   ' + path + 'נדחו / ' +
        addLabFile_(rejectedFolder, client, client.rejected));
    }
  });

  logEvent_({ actor: 'system', event: 'naming_lab', details: 'נוצרה מעבדת שמות: ' + created.length + ' קבצים' });
  console.log('מעבדת השמות מוכנה: ' + lab.getUrl());
  console.log('נוצרו ' + created.length + ' קבצים. A: התאריך ראשון. B: שם העסק ראשון.');
  created.forEach(function (line) { console.log(line); });
}

function addLabFile_(folder, client, spec) {
  const extension = client.pdf ? 'pdf' : 'jpg';
  const name = labFileName_(spec[0], client, spec[1], spec[2], extension);
  folder.createFile(labSampleBlob_(extension, name));
  return name;
}

function labFileName_(scheme, client, docLabel, number, extension) {
  const business = cleanFileNamePart_(client.name);
  const doc = cleanFileNamePart_(docLabel);
  const seq = ('0' + number).slice(-2);
  const parts = scheme === 'A' ? [client.period, business, doc, seq] : [business, client.period, doc, seq];
  return parts.join('_') + '.' + extension;
}

function labSampleBlob_(extension, name) {
  const isPdf = extension === 'pdf';
  const bytes = Utilities.base64Decode(isPdf ? LAB_SAMPLE_PDF : LAB_SAMPLE_JPEG);
  return Utilities.newBlob(bytes, isPdf ? 'application/pdf' : 'image/jpeg', name);
}

// The sample files: a 120x72 image that says "Nelio · לדוגמה", and a one-page PDF.
const LAB_SAMPLE_JPEG = [
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJ',
  'TlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZ',
  'WVlZWVlZWVlZWVlZWVn/wAARCABIAHgDASIAAhEBAxEB/8QAGwABAQADAQEBAAAAAAAAAAAAAAQCAwUGAQf/xAAzEAABBAEB',
  'BwMDAgUFAAAAAAABAAIDBBESBRMUITFUozWCsUFRgSIyIzRhcZEkcnOh8P/EABYBAQEBAAAAAAAAAAAAAAAAAAABAv/EABgR',
  'AQEBAQEAAAAAAAAAAAAAAAABERIC/9oADAMBAAIRAxEAPwD2JNma5PHHY3TY9OBoB6hZ8Pb73xBK3qFz2fCqc4NaXOIDQMkn',
  'oFplLw9vvfEE4e33viC2st1nwOnZYhdC390geC0f3K2seyRjXxua9jhkOacghFS8Pb73xBOHt974gqZZY4YzJK9sbG9XOOAP',
  'ysBZgMkcYniL5G6mN1jLh9wPqEGnh7fe+IJw9vvfEFWiCTh7fe+IJw9vvfEFWiCTh7fe+IJw9vvfEFWiCTh7fe+IJw9vvfEF',
  'WiCEGzDcgjksb1smrI0AdAizs+oU/f8ACIFb1C57PhbL/wDIWf8Aid8Fa63qFz2fCqkY2SNzHjLXAgj7goPz2u6ShsFxcSa2',
  '0InD/ZI1xA/yB/7C7Z2jYrUNiVKwcDYjbqc0NLsADk3Vyz/ddt2yKLtntomAGs05DNR5HOeuc/UrKTZtSWrFXfCDFDjdjJyz',
  'HTB6q6mOHtJ+0TsTabL0ThEA0wyPLNRGociGnCQWHR7V2LGGsLTSDj/DaXcmHo7GR+Cu47ZtR9eWB8bnslAD9UjiXY6cyc/9',
  'r63Z1RtiCcRYlrs3cbtR/S3GMdef5TR54bX2g7Yb9riw0FsuBX0DRpyBjPXPP7r1EMm9hjkwW62h2D9MhRnY1AvLjXGC/WWa',
  'joLvvpzjP4V6lUREQEREBERBJZ9Qp+/4RLPqFP3/AAiBW9Quez4VakreoXPZ8KpxIaS0AnHIE4CD6ihbdmZLA2xDE2Od2lj4',
  'pS8ZwSM5aOuFqdtOfeWmsp6uFJ3hMmMjGRp5cyRzxy/upsb4rpoo33tL6zt2DXsFrWvDuYJGRkY6f1ykduecTbiCMuimdGQ+',
  'UtBx9eTT/hNTmrEXKjmvXd1PFHFGIZntdGZ3YfjLeZ0/fn0VWz7cltkznxNj3chjBa/UHY6kHA+vL8JpfFitERVkREQEREEl',
  'n1Cn7/hEs+oU/f8ACIFb1C57PhUys3kL4841NLc/bKmreoXPZ8KtKRHwH+noxbz+Vc12dP7sNI/HVYmjK2Oy2KdgdYkc5znx',
  'l2AQBgfqHQDqrkUxrqubJs2SSGrFxIaytoczEfMubjmefTGeX9VXUrcNv/16t7K6TpjGfot6JhfVsxLXqOr1ZYmS/re572v0',
  '/tLiT0zzxlbKldtSrFAzm2NuM/f7lbkTEttERFUEREBERBJZ9Qp+/wCESz6hT9/wiDAizDcnkjr71smnB1gdAs+It9l5QiIH',
  'EW+y8oTiLfZeUIiBxFvsvKE4i32XlCIgcRb7LyhOIt9l5QiIHEW+y8oTiLfZeUIiBxFvsvKE4i32XlCIgcRb7LyhOIt9l5Qi',
  'IMALM1yCSSvumx6snWD1CIiD/9k='
].join('');

const LAB_SAMPLE_PDF = [
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5',
  'cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVu',
  'dCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTUwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAv',
  'RjEgNSAwIFIgPj4gPj4gPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0OCA+PgpzdHJlYW0KQlQgL0YxIDE4IFRmIDQw',
  'IDgwIFRkIChOZWxpbyAtIFNBTVBMRSAzLjIpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9u',
  'dCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1',
  'MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAw',
  'MDI0MSAwMDAwMCBuIAowMDAwMDAwMzM5IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFy',
  'dHhyZWYKNDA5CiUlRU9GCg=='
].join('');
