/**
 * Tendler Family Tree — Google Apps Script Backend
 * 
 * SETUP INSTRUCTIONS:
 * 1. Go to https://script.google.com and create a new project
 * 2. Paste this entire file into Code.gs (replace any existing code)
 * 3. Click Deploy → New deployment
 * 4. Select type: "Web app"
 * 5. Set "Execute as": Me (your Google account)
 * 6. Set "Who has access": Anyone
 * 7. Click Deploy and authorize when prompted
 * 8. Copy the Web App URL
 * 9. Paste the URL into APPS_SCRIPT_URL in app.js
 * 
 * That's it! The Add Member form will now write directly to your
 * Google Doc and both Spreadsheet tabs.
 */

// === CONFIGURATION ===
const DOC_ID = '18o4faR1TntMIWkh81W4yoLGZ5n9qOId1aXjxw8AcLQY';
const SPREADSHEET_ID = '1YnDzBpLyBD4wiSHmMxAadLVCw5bPdAwGZY7qpaz3u0U';
const BIRTHDAYS_SHEET_NAME = 'Birthdays';  // Name of the birthdays tab
const CONTACTS_SHEET_GID = 0;              // GID of the contacts tab

// === ENTRY POINT ===

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const results = {};

    // 1. Update the Google Doc
    results.doc = updateGoogleDoc(data);

    // 2. Update the Birthdays sheet
    results.birthdays = updateBirthdaysSheet(data);

    // 3. Update the Contacts sheet (spouse only, if contact info provided)
    if (data.type === 'spouse' && (data.email || data.address)) {
      results.contacts = updateContactsSheet(data);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', results: results }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Also handle CORS preflight
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Tendler Family Tree backend is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// === GOOGLE DOC UPDATE ===

function updateGoogleDoc(data) {
  const doc = DocumentApp.openById(DOC_ID);
  const body = doc.getBody();
  const text = body.getText();

  if (data.type === 'spouse') {
    // Find the parent's name in the doc and update the line to include spouse
    // e.g., "Moshe Tendler" → "Moshe Tendler and Sarah (Cohen)"
    const parentName = data.parentName;
    const searchResult = body.findText(parentName);
    
    if (searchResult) {
      const element = searchResult.getElement();
      const elementText = element.getText();
      
      // Build the spouse addition text
      let spouseText = ` and ${data.firstName}`;
      if (data.lastName) {
        spouseText += ` (${data.lastName})`;
      }
      
      // Find where the parent name ends in this element and insert spouse text
      const startOffset = searchResult.getStartOffset();
      const endOffset = searchResult.getEndOffsetInclusive();
      
      // Check if there's already an "and" after the name (avoid duplicates)
      const afterName = elementText.substring(endOffset + 1);
      if (!afterName.trimStart().startsWith('and ')) {
        element.asText().insertText(endOffset + 1, spouseText);
      }
      
      return { updated: true, action: 'added_spouse' };
    }
    return { updated: false, reason: 'parent_not_found' };

  } else {
    // Adding a child — find the parent and add a new bullet below their children
    const parentName = data.parentName;
    
    // Search through all paragraphs to find the parent
    const paragraphs = body.getParagraphs();
    let parentIndex = -1;
    let parentIndent = 0;
    
    for (let i = 0; i < paragraphs.length; i++) {
      const pText = paragraphs[i].getText();
      if (pText.includes(parentName)) {
        parentIndex = i;
        // Count leading spaces/bullets to determine indent level
        const match = pText.match(/^(\s*)/);
        parentIndent = match ? match[1].length : 0;
        break;
      }
    }
    
    if (parentIndex >= 0) {
      // Find the last child of this parent (next item at same or lower indent, or end)
      let insertAfter = parentIndex;
      const childIndent = parentIndent + 3; // Children are indented 3 more spaces
      
      for (let i = parentIndex + 1; i < paragraphs.length; i++) {
        const pText = paragraphs[i].getText();
        const match = pText.match(/^(\s*)/);
        const indent = match ? match[1].length : 0;
        
        if (indent >= childIndent) {
          insertAfter = i; // This is a child or grandchild, keep going
        } else {
          break; // We've passed all children
        }
      }
      
      // Insert the new child after the last child
      const spaces = ' '.repeat(childIndent);
      const newChildText = `${spaces}* ${data.firstName}`;
      
      // Insert after the found position
      const insertElement = paragraphs[insertAfter];
      const insertIndex = body.getChildIndex(insertElement);
      body.insertParagraph(insertIndex + 1, newChildText);
      
      return { updated: true, action: 'added_child', afterIndex: insertAfter };
    }
    
    return { updated: false, reason: 'parent_not_found' };
  }
}

// === BIRTHDAYS SHEET UPDATE ===

function updateBirthdaysSheet(data) {
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  
  // Find the Birthdays sheet by name or GID
  let sheet = null;
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase().includes('birthday')) {
      sheet = sheets[i];
      break;
    }
  }
  
  if (!sheet) {
    sheet = ss.getSheets().find(s => s.getSheetId() === 275461243);
  }
  
  if (!sheet) {
    return { updated: false, reason: 'birthdays_sheet_not_found' };
  }
  
  // Determine last name
  let lastName = data.lastName;
  if (!lastName && data.parentName) {
    const parts = data.parentName.split(' ');
    lastName = parts[parts.length - 1] || 'Tendler';
  }
  
  // Append row: [Last Name, First Name, Birthday Date, Jewish Birthday]
  sheet.appendRow([
    lastName,
    data.firstName,
    data.birthday || '',
    data.hebrewBirthday || ''
  ]);
  
  return { updated: true };
}

// === CONTACTS SHEET UPDATE ===

function updateContactsSheet(data) {
  let ss;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  const sheet = ss.getSheets()[0]; // First sheet (contacts, GID 0)
  
  if (!sheet) {
    return { updated: false, reason: 'contacts_sheet_not_found' };
  }
  
  // Determine last name
  let lastName = data.lastName;
  if (!lastName && data.parentName) {
    const parts = data.parentName.split(' ');
    lastName = parts[parts.length - 1] || 'Tendler';
  }
  
  // Build the names field: "ParentName & SpouseName"
  const names = `${data.parentName} & ${data.firstName}`;
  const title = 'Mr. & Mrs.';
  
  // Append row matching the contacts sheet format:
  // [Last, First/Names, Title, Street/Address, City, State, Zip, Email, 2nd Email]
  sheet.appendRow([lastName, names, title, data.address || '', '', '', '', data.email || '', '']);
  
  return { updated: true };
}
