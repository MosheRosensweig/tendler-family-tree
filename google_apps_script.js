/**
 * Tendler Family Tree — Google Apps Script Backend
 * 
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 */

// === CONFIGURATION ===
const DOC_ID = '18o4faR1TntMIWkh81W4yoLGZ5n9qOId1aXjxw8AcLQY';
const SPREADSHEET_ID = '1YnDzBpLyBD4wiSHmMxAadLVCw5bPdAwGZY7qpaz3u0U';
const BIRTHDAYS_SHEET_NAME = 'Birthdays';
const CONTACTS_SHEET_GID = 0;

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

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Tendler Family Tree backend is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// === GOOGLE DOC UPDATE ===

function updateGoogleDoc(data) {
  const doc = DocumentApp.openById(DOC_ID);
  const body = doc.getBody();

  if (data.type === 'spouse') {
    const parentName = data.parentName;
    const searchResult = body.findText(parentName);
    
    if (searchResult) {
      const element = searchResult.getElement();
      const elementText = element.getText();
      
      let spouseText = ' and ' + data.firstName;
      if (data.lastName) {
        spouseText += ' (' + data.lastName + ')';
      }
      
      const endOffset = searchResult.getEndOffsetInclusive();
      const afterName = elementText.substring(endOffset + 1);
      if (!afterName.trimStart().startsWith('and ')) {
        element.asText().insertText(endOffset + 1, spouseText);
      }
      
      return { updated: true, action: 'added_spouse' };
    }
    return { updated: false, reason: 'parent_not_found' };

  } else {
    // Adding a child — find the parent and add a new list item below their children
    const parentName = data.parentName;
    
    // Search through all elements to find the parent
    var numChildren = body.getNumChildren();
    var parentIdx = -1;
    var parentElement = null;
    var parentNesting = 0;
    
    for (var i = 0; i < numChildren; i++) {
      var child = body.getChild(i);
      var text = child.getText();
      if (text.includes(parentName)) {
        parentIdx = i;
        parentElement = child;
        // Determine nesting from the parent element
        if (child.getType() === DocumentApp.ElementType.LIST_ITEM) {
          parentNesting = child.asListItem().getNestingLevel();
        } else {
          // Count leading spaces as fallback
          var spaceMatch = text.match(/^(\s*)/);
          parentNesting = spaceMatch ? Math.floor(spaceMatch[1].length / 3) : 0;
        }
        break;
      }
    }
    
    if (parentIdx >= 0) {
      // Find the last child/descendant of this parent
      var insertAfterIdx = parentIdx;
      var childNesting = parentNesting + 1;
      
      for (var j = parentIdx + 1; j < numChildren; j++) {
        var el = body.getChild(j);
        var elNesting = 0;
        if (el.getType() === DocumentApp.ElementType.LIST_ITEM) {
          elNesting = el.asListItem().getNestingLevel();
        } else {
          var elText = el.getText();
          var sm = elText.match(/^(\s*)/);
          elNesting = sm ? Math.floor(sm[1].length / 3) : 0;
        }
        
        if (elNesting >= childNesting) {
          insertAfterIdx = j;
        } else {
          break;
        }
      }
      
      // Insert a new ListItem after the last child, matching the nesting of siblings
      var newItem = body.insertListItem(insertAfterIdx + 1, data.firstName);
      
      // Try to copy the list formatting from an existing sibling
      // Look for an existing child at childNesting level
      var siblingFound = false;
      for (var k = parentIdx + 1; k <= insertAfterIdx; k++) {
        var sib = body.getChild(k);
        if (sib.getType() === DocumentApp.ElementType.LIST_ITEM) {
          var sibNesting = sib.asListItem().getNestingLevel();
          if (sibNesting === childNesting) {
            // Copy the list ID and glyph type from the sibling
            newItem.setListId(sib.asListItem());
            newItem.setNestingLevel(childNesting);
            newItem.setGlyphType(sib.asListItem().getGlyphType());
            siblingFound = true;
            break;
          }
        }
      }
      
      if (!siblingFound) {
        // No sibling found — just set the nesting and use bullet glyph
        newItem.setNestingLevel(childNesting);
        newItem.setGlyphType(DocumentApp.GlyphType.BULLET);
      }
      
      return { updated: true, action: 'added_child', afterIndex: insertAfterIdx };
    }
    
    return { updated: false, reason: 'parent_not_found' };
  }
}

// === BIRTHDAYS SHEET UPDATE ===

function updateBirthdaysSheet(data) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    return { updated: false, reason: 'cannot_open_spreadsheet: ' + e.toString() };
  }
  
  // Find the Birthdays sheet by name or GID
  var sheet = null;
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getName().toLowerCase().includes('birthday')) {
      sheet = sheets[i];
      break;
    }
  }
  
  if (!sheet) {
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === 275461243) {
        sheet = sheets[i];
        break;
      }
    }
  }
  
  if (!sheet) {
    return { updated: false, reason: 'birthdays_sheet_not_found' };
  }
  
  // The client now sends the resolved family surname in data.familyName
  var lastName = data.familyName || data.lastName || 'Tendler';
  
  // Find the last row with this family name and insert after it
  var allData = sheet.getDataRange().getValues();
  var insertRow = -1;
  
  for (var r = allData.length - 1; r >= 0; r--) {
    var cellLastName = (allData[r][0] || '').toString().trim().toLowerCase();
    if (cellLastName === lastName.toLowerCase()) {
      insertRow = r + 2; // +1 for 0-index→1-index, +1 for "after"
      break;
    }
  }
  
  var newRow = [lastName, data.firstName, data.birthday || '', data.hebrewBirthday || ''];
  
  if (insertRow > 0) {
    // Insert a new row after the last matching family member
    sheet.insertRowAfter(insertRow - 1);
    sheet.getRange(insertRow, 1, 1, newRow.length).setValues([newRow]);
  } else {
    // Family not found — append at the end
    sheet.appendRow(newRow);
  }
  
  return { updated: true, insertedAt: insertRow > 0 ? insertRow : 'end' };
}

// === CONTACTS SHEET UPDATE ===

function updateContactsSheet(data) {
  var ss;
  try {
    ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    return { updated: false, reason: 'cannot_open_spreadsheet: ' + e.toString() };
  }
  var sheet = ss.getSheets()[0];
  
  if (!sheet) {
    return { updated: false, reason: 'contacts_sheet_not_found' };
  }
  
  var lastName = data.familyName || data.lastName || 'Tendler';
  var names = data.parentName + ' & ' + data.firstName;
  var title = 'Mr. & Mrs.';
  
  sheet.appendRow([lastName, names, title, data.address || '', '', '', '', data.email || '', '']);
  
  return { updated: true };
}
