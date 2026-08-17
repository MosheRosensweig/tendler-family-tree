/**
 * Tendler Family Tree - Dynamic Google Doc Parser & Renderer
 * Fetches the family tree data from a published Google Doc and renders
 * an interactive, collapsible tree view.
 */

const DOC_ID = '18o4faR1TntMIWkh81W4yoLGZ5n9qOId1aXjxw8AcLQY';
const EXPORT_URL = `https://docs.google.com/document/d/${DOC_ID}/export?format=txt`;

const CONTACTS_SPREADSHEET_ID = '1YnDzBpLyBD4wiSHmMxAadLVCw5bPdAwGZY7qpaz3u0U';
const CONTACTS_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${CONTACTS_SPREADSHEET_ID}/export?format=csv`;
const BIRTHDAYS_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${CONTACTS_SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=275461243`;

// Google Apps Script Web App URL — set this after deploying the script
// See google_apps_script.js for setup instructions
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzRHl85JPhc9DX9jAnpnEJbb5WibsFEmKSMfqSYgqlRlLZiYk8ww4CAnvXVZOEKQnBykA/exec';

let parsedContacts = [];
let parsedBirthdays = [];

// We use a CORS proxy approach. Google Docs export works directly in browsers
// when the doc is shared publicly. If CORS blocks it, we fall back to the 
// embedded data or a proxy.
const CORS_PROXIES = [
    (url) => url, // Direct (works if doc is public)
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];

// ============================================
// DATA STRUCTURES
// ============================================

/**
 * Represents a person/node in the family tree
 * @typedef {Object} TreeNode
 * @property {string} name - Primary name
 * @property {string} [spouseName] - Spouse's name (if married)
 * @property {string} [maidenName] - Spouse's maiden name
 * @property {TreeNode[]} children - Child nodes
 * @property {number} depth - Depth in the tree (0 = root)
 * @property {number} [number] - Numbered position among siblings
 */

// ============================================
// GOOGLE DOC PARSER
// ============================================

/**
 * Parse the raw text exported from Google Docs into a tree structure.
 * The doc uses a specific indentation pattern:
 *   - Root: "Saba (...) and Savta (...)"
 *   - Children numbered: "1. Name and Spouse"
 *   - Grandchildren numbered: "   1. Name and Spouse"
 *   - Great-grandchildren bulleted: "      * Name"
 *   - Great-great-grandchildren numbered: "         1. Name"
 */
function parseGoogleDocText(rawText) {
    const lines = rawText.split('\n')
        .map(l => l.replace(/\r/g, ''))
        .filter(l => l.trim().length > 0);

    // Find the root line (Saba and Savta)
    let rootLine = null;
    let dataStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('Saba') && lines[i].includes('Savta')) {
            rootLine = lines[i].trim();
            dataStartIndex = i + 1;
            break;
        }
    }

    if (!rootLine) {
        throw new Error('Could not find the root of the family tree (Saba and Savta line)');
    }

    // Parse root names
    const root = parseRootLine(rootLine);
    
    // Parse the rest of the tree using indentation levels
    const dataLines = [];
    for (let i = dataStartIndex; i < lines.length; i++) {
        const line = lines[i];
        // Stop at "Family Titles" or similar non-tree content
        if (line.trim().startsWith('Family Titles') || 
            line.trim().startsWith('https://')) {
            break;
        }
        if (line.trim().length > 0) {
            dataLines.push(line);
        }
    }

    root.children = parseIndentedLines(dataLines, 0);
    return root;
}

function parseRootLine(line) {
    // "Saba (Moshe David Tendler) and Savta (Shifra/Sifra Feinstein)"
    const match = line.match(/Saba\s*\(([^)]+)\)\s*and\s*Savta\s*\(([^)]+)\)/i);
    if (match) {
        return {
            name: match[1].trim(),
            spouseName: match[2].trim(),
            title: 'Saba & Savta',
            children: [],
            depth: 0
        };
    }
    return { name: line, children: [], depth: 0 };
}

/**
 * Determine the indentation level and content type of a line.
 * Returns { level, number, content }
 * Google Docs export format:
 *   "1. Name"          -> level 0 (children of root)
 *   "   1. Name"       -> level 1 (grandchildren)
 *   "      * Name"     -> level 2 (great-grandchildren via bullet)
 *   "         1. Name" -> level 3 (great-great-grandchildren)
 */
function parseLine(line) {
    // Count leading spaces
    const leadingSpaces = line.match(/^(\s*)/)[1].length;
    const trimmed = line.trim();
    
    // Check for numbered item: "1. Content" or "10. Content"
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    // Check for bulleted item: "* Content"
    const bulletMatch = trimmed.match(/^\*\s+(.+)/);
    
    let content, number;
    if (numberedMatch) {
        number = parseInt(numberedMatch[1]);
        content = numberedMatch[2];
    } else if (bulletMatch) {
        content = bulletMatch[1];
        number = null;
    } else {
        content = trimmed;
        number = null;
    }
    
    // Determine level from indentation
    // Level 0: 0 spaces (top-level numbered)
    // Level 1: ~3 spaces (sub-numbered)
    // Level 2: ~6 spaces (bullets)
    // Level 3: ~9 spaces (sub-sub-numbered)
    let level;
    if (leadingSpaces <= 1) {
        level = 0;
    } else if (leadingSpaces <= 4) {
        level = 1;
    } else if (leadingSpaces <= 7) {
        level = 2;
    } else if (leadingSpaces <= 11) {
        level = 3;
    } else {
        level = 4;
    }
    
    return { level, number, content };
}

/**
 * Parse an array of indented lines into a hierarchical tree.
 * Uses the indentation level to determine parent-child relationships.
 */
function parseIndentedLines(lines, baseDepth) {
    const result = [];
    let i = 0;
    
    while (i < lines.length) {
        const parsed = parseLine(lines[i]);
        const node = parsePersonLine(parsed.content);
        node.depth = baseDepth + 1;
        node.number = parsed.number;
        node.children = [];
        
        // Collect all children (lines at a deeper level)
        const childLines = [];
        let j = i + 1;
        while (j < lines.length) {
            const nextParsed = parseLine(lines[j]);
            if (nextParsed.level <= parsed.level) {
                break;
            }
            childLines.push(lines[j]);
            j++;
        }
        
        if (childLines.length > 0) {
            node.children = parseIndentedLines(childLines, node.depth);
        }
        
        result.push(node);
        i = j;
    }
    
    return result;
}

/**
 * Parse a person line like "Name and Spouse (MaidenName)" into structured data.
 */
function parsePersonLine(text) {
    text = text.trim();
    
    // Try to match "Name and Spouse (MaidenName)"
    // Handle various patterns:
    // "Rivky and Shabtai Rappaport"
    // "Yacov and Yael (Geffen)"  
    // "Shlomo Menachem and Chani (Heimowitz)"
    // "Bella Renana and Yosef Krumbein"
    // Also handle cases like "Miriam And Dovid Bender" (capitalized And)
    
    const coupleMatch = text.match(/^(.+?)\s+[Aa]nd\s+(.+)$/);
    
    if (coupleMatch) {
        let name1 = coupleMatch[1].trim();
        let name2 = coupleMatch[2].trim();
        
        // Check if name2 has a maiden name in parentheses
        const maidenMatch = name2.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
        let maidenName = null;
        if (maidenMatch) {
            name2 = maidenMatch[1].trim();
            maidenName = maidenMatch[2].trim();
        }
        
        return {
            name: name1,
            spouseName: name2,
            maidenName: maidenName,
            fullText: text,
            children: [],
            depth: 0
        };
    }
    
    // Single person (no "and")
    return {
        name: text,
        spouseName: null,
        maidenName: null,
        fullText: text,
        children: [],
        depth: 0
    };
}

// ============================================
// TREE RENDERER
// ============================================

function renderTree(root) {
    currentTreeData = root;
    const container = document.getElementById('tree-root');
    container.innerHTML = '';
    
    // Render root node
    const rootEl = renderRootNode(root);
    container.appendChild(rootEl);
    
    // Render children (the major family branches)
    const branchesEl = document.createElement('div');
    branchesEl.className = 'branches';
    
    root.children.forEach((child, index) => {
        const branchEl = renderBranch(child, 1, index);
        branchesEl.appendChild(branchEl);
    });
    
    container.appendChild(branchesEl);
    
    // Update stats
    updateStats(root);
}

function renderRootNode(node) {
    const el = document.createElement('div');
    el.className = 'tree-root-node';
    
    let nameHtml = `<span class="primary-name">${escapeHtml(node.name)}</span>`;
    if (node.spouseName) {
        nameHtml += ` <span class="amp">&amp;</span> <span class="spouse-name">${escapeHtml(node.spouseName)}</span>`;
    }
    
    el.innerHTML = `
        <div class="person-name">${nameHtml}</div>
        <div class="person-detail">${escapeHtml(node.title || 'Saba & Savta')}</div>
    `;
    return el;
}

/**
 * Render a branch (a person who may have children).
 * If the person has children, they get an expandable branch.
 * If not, they get a simple leaf node.
 */
function renderBranch(node, generation, siblingIndex) {
    const hasChildren = node.children && node.children.length > 0;
    
    if (!hasChildren) {
        return renderLeafNode(node, generation);
    }
    
    const container = document.createElement('div');
    container.className = `branch-container gen-${generation}`;
    container.dataset.name = (node.fullText || node.name || '').toLowerCase();
    
    // Branch header
    const header = document.createElement('div');
    header.className = 'branch-header';
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    
    const expandIcon = `<div class="expand-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg></div>`;
    
    const numValue = node.number != null ? node.number : '';
    const displayNum = isCountRevealed ? (numValue || '•') : '•';
    const numberBadge = `<span class="branch-number" data-number="${numValue}">${displayNum}</span>`;
    
    let nameHtml = `<span class="person-name">${escapeHtml(node.name)}`;
    if (node.spouseName) {
        nameHtml += ` <span class="spouse-name">& ${escapeHtml(node.spouseName)}`;
        if (node.maidenName) {
            nameHtml += ` <span style="opacity:0.6">(${escapeHtml(node.maidenName)})</span>`;
        }
        nameHtml += `</span>`;
    }
    nameHtml += `</span>`;
    
    const childCount = countDescendants(node);
    const plural = childCount !== 1 ? 's' : '';
    const countText = isCountRevealed ? `${childCount} descendant${plural}` : `B"H descendant${plural}`;
    const revealedClass = isCountRevealed ? ' revealed' : '';
    const countBadge = `<button class="child-count${revealedClass}" data-count="${childCount}" title="Click for count options">${countText}</button>`;
    
    const contact = findContactForNode(node);
    const nodeBirthdays = getBirthdaysForNode(node);
    const birthdayBadgeHtml = nodeBirthdays.length > 0 ? `<button class="node-birthday-badge" title="View birthday information">🎂</button>` : '';
    const contactBadgeHtml = contact ? `<button class="contact-badge" title="View contact details"><span class="contact-badge-icon">📇</span> Contact</button>` : '';

    header.innerHTML = `${expandIcon}${numberBadge}${nameHtml}${countBadge}${birthdayBadgeHtml}${contactBadgeHtml}`;
    
    // Attach listener to child-count B"H button
    const countBtn = header.querySelector('.child-count');
    if (countBtn) {
        countBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showBHModal();
        });
    }

    const bdayBtn = header.querySelector('.node-birthday-badge');
    if (bdayBtn) {
        bdayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showPersonBirthdayModal(node);
        });
    }

    if (contact) {
        header.classList.add('has-contact');
        const badgeBtn = header.querySelector('.contact-badge');
        if (badgeBtn) {
            badgeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showContactModal(contact, node.name);
            });
        }
    }

    // Branch content (children)
    const content = document.createElement('div');
    content.className = 'branch-content';
    
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'branch-children';
    
    node.children.forEach((child, idx) => {
        const childEl = renderBranch(child, generation + 1, idx);
        childrenContainer.appendChild(childEl);
    });
    
    content.appendChild(childrenContainer);
    container.appendChild(header);
    container.appendChild(content);
    
    // Toggle expand/collapse when clicking header (unless clicking contact badge, birthday badge, or count badge)
    header.addEventListener('click', (e) => {
        if (!e.target.closest('.contact-badge') && !e.target.closest('.node-birthday-badge') && !e.target.closest('.child-count')) {
            toggleBranch(header, content);
        }
    });
    header.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleBranch(header, content);
        }
    });
    
    return container;
}

function renderLeafNode(node, generation) {
    const el = document.createElement('div');
    el.className = `leaf-node gen-${generation}`;
    el.dataset.name = (node.fullText || node.name || '').toLowerCase();
    
    let nameHtml = `<span class="person-name">${escapeHtml(node.name)}`;
    if (node.spouseName) {
        nameHtml += ` <span class="spouse-name">& ${escapeHtml(node.spouseName)}`;
        if (node.maidenName) {
            nameHtml += ` <span style="opacity:0.6">(${escapeHtml(node.maidenName)})</span>`;
        }
        nameHtml += `</span>`;
    }
    nameHtml += `</span>`;
    
    const contact = findContactForNode(node);
    const nodeBirthdays = getBirthdaysForNode(node);
    const birthdayBadgeHtml = nodeBirthdays.length > 0 ? `<button class="node-birthday-badge" title="View birthday information">🎂</button>` : '';
    const contactBadgeHtml = contact ? `<button class="contact-badge" title="View contact details"><span class="contact-badge-icon">📇</span> Contact</button>` : '';

    el.innerHTML = `<span class="leaf-dot"></span>${nameHtml}${birthdayBadgeHtml}${contactBadgeHtml}`;

    const bdayBtn = el.querySelector('.node-birthday-badge');
    if (bdayBtn) {
        bdayBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showPersonBirthdayModal(node);
        });
    }

    if (contact) {
        el.classList.add('has-contact');
        const badgeBtn = el.querySelector('.contact-badge');
        if (badgeBtn) {
            badgeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showContactModal(contact, node.name);
            });
        }
        el.addEventListener('click', (e) => {
            if (!e.target.closest('.contact-badge') && !e.target.closest('.node-birthday-badge')) {
                showContactModal(contact, node.name);
            }
        });
    }

    return el;
}

function toggleBranch(header, content) {
    const isExpanded = header.classList.contains('expanded');
    if (isExpanded) {
        header.classList.remove('expanded');
        content.classList.remove('expanded');
        header.setAttribute('aria-expanded', 'false');
    } else {
        header.classList.add('expanded');
        content.classList.add('expanded');
        header.setAttribute('aria-expanded', 'true');
    }
}

// ============================================
// STATS & UTILITIES
// ============================================

function countDescendants(node) {
    if (!node.children || node.children.length === 0) return 0;
    let count = node.children.length;
    node.children.forEach(child => {
        count += countDescendants(child);
    });
    return count;
}

function countAllMembers(node) {
    let count = 1; // Count self
    if (node.spouseName) count++; // Count spouse
    if (node.children) {
        node.children.forEach(child => {
            count += countAllMembers(child);
        });
    }
    return count;
}

function getMaxDepth(node) {
    if (!node.children || node.children.length === 0) return 1;
    let maxChildDepth = 0;
    node.children.forEach(child => {
        const d = getMaxDepth(child);
        if (d > maxChildDepth) maxChildDepth = d;
    });
    return 1 + maxChildDepth;
}

let totalMemberCount = 0;
let isCountRevealed = false;

function updateStats(root) {
    const total = countAllMembers(root);
    const generations = getMaxDepth(root);
    const branches = root.children ? root.children.length : 0;
    
    totalMemberCount = total;
    updateAllCounts();
    
    animateNumber('stat-gen-number', generations);
    animateNumber('stat-families-number', branches);
}

function animateNumber(elementId, target) {
    const el = document.getElementById(elementId);
    const duration = 1200;
    const start = 0;
    const startTime = performance.now();
    
    function update(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(start + (target - start) * eased);
        el.textContent = current;
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }
    
    requestAnimationFrame(update);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================
// SEARCH
// ============================================

// ============================================
// SEARCH & AUTOCOMPLETE
// ============================================

let currentMatches = [];
let currentMatchIndex = -1;
let autocompleteItems = [];
let selectedAutocompleteIndex = -1;

function setupSearch() {
    const input = document.getElementById('search-input');
    const clearBtn = document.getElementById('clear-search');
    const dropdown = document.getElementById('autocomplete-dropdown');
    const resultsLabel = document.getElementById('search-results');
    const addMemberBtn = document.getElementById('add-member-btn');
    let debounceTimer;

    function checkUnlock(val) {
        const cleaned = (val || '').toLowerCase().replace(/['"“”]/g, '').trim();
        if (cleaned === 'add member' || cleaned === 'addmember') {
            if (addMemberBtn) {
                addMemberBtn.style.setProperty('display', 'inline-flex', 'important');
            }
            input.value = '';
            if (clearBtn) clearBtn.classList.remove('visible');
            clearSearch();
            hideAutocomplete();
            if (resultsLabel) {
                resultsLabel.textContent = '✨ Add Member unlocked';
                setTimeout(() => {
                    if (resultsLabel.textContent === '✨ Add Member unlocked') {
                        resultsLabel.textContent = '';
                    }
                }, 4000);
            }
            return true;
        }
        return false;
    }

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value;

        if (checkUnlock(query)) {
            return;
        }

        clearBtn.classList.toggle('visible', query.trim().length > 0);

        debounceTimer = setTimeout(() => {
            const qTrim = input.value.trim();
            if (qTrim.length === 0) {
                clearSearch();
                hideAutocomplete();
                resultsLabel.textContent = '';
                return;
            }
            performSearch(qTrim);
        }, 150);
    });

    input.addEventListener('keydown', (e) => {
        if (checkUnlock(input.value)) {
            e.preventDefault();
            return;
        }

        const isDropdownVisible = dropdown && dropdown.style.display !== 'none' && autocompleteItems.length > 0;

        if (e.key === 'ArrowDown') {
            if (isDropdownVisible) {
                e.preventDefault();
                selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, autocompleteItems.length - 1);
                updateSelectedAutocompleteItem();
            }
        } else if (e.key === 'ArrowUp') {
            if (isDropdownVisible) {
                e.preventDefault();
                selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
                updateSelectedAutocompleteItem();
            }
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (isDropdownVisible && selectedAutocompleteIndex >= 0) {
                selectAutocompleteItem(selectedAutocompleteIndex);
            } else if (currentMatches.length > 0) {
                hideAutocomplete();
                if (e.shiftKey) {
                    currentMatchIndex = (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length;
                } else {
                    currentMatchIndex = (currentMatchIndex + 1) % currentMatches.length;
                }
                focusMatch(currentMatchIndex);
            }
        } else if (e.key === 'Escape') {
            hideAutocomplete();
        }
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.classList.remove('visible');
        clearSearch();
        hideAutocomplete();
        resultsLabel.textContent = '';
        input.focus();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            hideAutocomplete();
        }
    });
}

function calculateMatchScore(query, text) {
    const q = query.trim().toLowerCase();
    const t = text.toLowerCase();

    if (t === q) return 1000;
    if (t.startsWith(q)) return 800;

    const words = t.split(/[\s(),&]+/);
    for (let i = 0; i < words.length; i++) {
        if (words[i].startsWith(q)) {
            return 600 - (i * 10);
        }
    }

    const idx = t.indexOf(q);
    if (idx !== -1) {
        return 400 - idx;
    }

    return 0;
}

function getAncestorPath(node) {
    const pathParts = [];
    let current = node.parentElement;

    while (current) {
        if (current.classList.contains('branch-container')) {
            const header = current.querySelector(':scope > .branch-header');
            if (header && header !== node) {
                const nameEl = header.querySelector('.person-name');
                if (nameEl) {
                    const cleanName = nameEl.textContent.replace(/\s+/g, ' ').trim();
                    pathParts.unshift(cleanName);
                }
            }
        }
        current = current.parentElement;
    }

    return pathParts.join(' > ');
}

function performSearch(query) {
    const resultsLabel = document.getElementById('search-results');
    const normalizedQuery = query.toLowerCase();

    clearSearch();

    const allNodes = document.querySelectorAll('.leaf-node, .branch-header');
    const matchesWithScores = [];

    allNodes.forEach(node => {
        const nameEl = node.querySelector('.person-name');
        if (!nameEl) return;

        const text = nameEl.textContent;
        const normalizedText = text.toLowerCase();

        if (normalizedText.includes(normalizedQuery)) {
            expandParents(node);
            highlightText(nameEl, query);

            const container = node.closest('.branch-container') || node;
            container.classList.add('search-match');

            const score = calculateMatchScore(query, text);
            const path = getAncestorPath(node);

            matchesWithScores.push({
                node: node,
                name: text.replace(/\s+/g, ' ').trim(),
                path: path,
                score: score
            });
        }
    });

    matchesWithScores.sort((a, b) => b.score - a.score);

    currentMatches = matchesWithScores.map(m => m.node);
    autocompleteItems = matchesWithScores;
    selectedAutocompleteIndex = -1;

    if (currentMatches.length > 0) {
        currentMatchIndex = 0;
        focusMatch(0, false);
        renderAutocomplete(query);
    } else {
        currentMatchIndex = -1;
        hideAutocomplete();
        resultsLabel.textContent = 'No matches found';
    }
}

function focusMatch(index, scroll = true) {
    const resultsLabel = document.getElementById('search-results');

    document.querySelectorAll('.active-search-match').forEach(el => {
        el.classList.remove('active-search-match');
    });

    if (index < 0 || index >= currentMatches.length) return;

    const activeNode = currentMatches[index];
    const highlightTarget = activeNode.classList.contains('branch-header') 
        ? activeNode 
        : activeNode;

    highlightTarget.classList.add('active-search-match');

    resultsLabel.textContent = `Match ${index + 1} of ${currentMatches.length} (Press Enter for next)`;

    if (scroll) {
        highlightTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function renderAutocomplete(query) {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (!dropdown) return;

    if (autocompleteItems.length === 0) {
        hideAutocomplete();
        return;
    }

    dropdown.innerHTML = '';

    autocompleteItems.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        if (index === selectedAutocompleteIndex) {
            div.classList.add('selected');
        }

        const nameDiv = document.createElement('div');
        nameDiv.className = 'autocomplete-item-name';
        nameDiv.innerHTML = highlightMatchHTML(item.name, query);

        div.appendChild(nameDiv);

        if (item.path) {
            const pathDiv = document.createElement('div');
            pathDiv.className = 'autocomplete-item-path';
            pathDiv.textContent = item.path;
            div.appendChild(pathDiv);
        }

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            selectAutocompleteItem(index);
        });

        dropdown.appendChild(div);
    });

    dropdown.style.display = 'block';
}

function highlightMatchHTML(text, query) {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);

    if (idx === -1) return escapeHtml(text);

    const before = text.substring(0, idx);
    const match = text.substring(idx, idx + query.length);
    const after = text.substring(idx + query.length);

    return `${escapeHtml(before)}<span class="search-highlight">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function updateSelectedAutocompleteItem() {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (!dropdown) return;

    const items = dropdown.querySelectorAll('.autocomplete-item');
    items.forEach((item, idx) => {
        if (idx === selectedAutocompleteIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.classList.remove('selected');
        }
    });
}

function selectAutocompleteItem(index) {
    if (index < 0 || index >= autocompleteItems.length) return;

    const item = autocompleteItems[index];
    const input = document.getElementById('search-input');

    input.value = item.name;
    hideAutocomplete();

    currentMatchIndex = index;
    focusMatch(index, true);
}

function hideAutocomplete() {
    const dropdown = document.getElementById('autocomplete-dropdown');
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    selectedAutocompleteIndex = -1;
}

function highlightText(element, query) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach(textNode => {
        const text = textNode.textContent;
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);

        if (index === -1) return;

        const before = text.substring(0, index);
        const match = text.substring(index, index + query.length);
        const after = text.substring(index + query.length);

        const span = document.createElement('span');
        span.className = 'search-highlight';
        span.textContent = match;

        const parent = textNode.parentNode;
        const frag = document.createDocumentFragment();
        if (before) frag.appendChild(document.createTextNode(before));
        frag.appendChild(span);
        if (after) frag.appendChild(document.createTextNode(after));

        parent.replaceChild(frag, textNode);
    });
}

function expandParents(node) {
    let current = node.parentElement;
    while (current) {
        if (current.classList.contains('branch-content')) {
            current.classList.add('expanded');
            const header = current.previousElementSibling;
            if (header && header.classList.contains('branch-header')) {
                header.classList.add('expanded');
                header.setAttribute('aria-expanded', 'true');
            }
        }
        current = current.parentElement;
    }
}

function clearSearch() {
    document.querySelectorAll('.search-highlight').forEach(el => {
        const parent = el.parentNode;
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
    });
    document.querySelectorAll('.search-match').forEach(el => {
        el.classList.remove('search-match');
    });
    document.querySelectorAll('.active-search-match').forEach(el => {
        el.classList.remove('active-search-match');
    });
    currentMatches = [];
    currentMatchIndex = -1;
    autocompleteItems = [];
    selectedAutocompleteIndex = -1;
}

// ============================================
// EXPAND / COLLAPSE ALL
// ============================================

function setupControls() {
    document.getElementById('expand-all').addEventListener('click', () => {
        document.querySelectorAll('.branch-header').forEach(header => {
            header.classList.add('expanded');
            header.setAttribute('aria-expanded', 'true');
        });
        document.querySelectorAll('.branch-content').forEach(content => {
            content.classList.add('expanded');
        });
    });
    
    document.getElementById('collapse-all').addEventListener('click', () => {
        document.querySelectorAll('.branch-header').forEach(header => {
            header.classList.remove('expanded');
            header.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.branch-content').forEach(content => {
            content.classList.remove('expanded');
        });
    });
    
    document.getElementById('refresh-btn').addEventListener('click', () => {
        loadFamilyTree();
    });
}

// ============================================
// CONTACT INFO & MODAL LOGIC
// ============================================

function parseCSV(text) {
    const lines = text.split('\n');
    const result = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const row = [];
        let inQuotes = false;
        let currentToken = '';
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                row.push(currentToken.trim());
                currentToken = '';
            } else {
                currentToken += char;
            }
        }
        row.push(currentToken.trim());
        result.push(row);
    }
    return result;
}

function processContactsCSV(csvText) {
    const rows = parseCSV(csvText);
    if (rows.length < 2) return [];
    
    const contacts = [];
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;
        
        const last = (row[0] || '').replace(/=/g, '').trim();
        const first = (row[1] || '').trim();
        const title = (row[2] || '').trim();
        const street = (row[3] || '').trim();
        const city = (row[4] || '').trim();
        const state = (row[5] || '').trim();
        const zip = (row[6] || '').trim();
        const email1 = (row[7] || '').replace(/=/g, '').trim();
        const email2 = (row[8] || '').replace(/=/g, '').trim();
        
        if (!first && !last) continue;
        
        const emails = [email1, email2].filter(e => e && e.includes('@'));
        
        contacts.push({
            last,
            first,
            title,
            street,
            city,
            state,
            zip,
            emails
        });
    }
    return contacts;
}

function findContactForNode(node) {
    if (!parsedContacts || parsedContacts.length === 0) return null;

    const nodeFullText = (node.fullText || `${node.name} ${node.spouseName || ''}`).toLowerCase();

    const tokenize = (str) => str.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 1 && !['and', 'mr', 'mrs', 'dr', 'rabbi', 'reb', 'r'].includes(w));

    const nodeTokens = tokenize(nodeFullText);

    let bestContact = null;
    let bestScore = 0;

    for (const c of parsedContacts) {
        const cTokens = tokenize(`${c.first} ${c.last}`);
        if (cTokens.length === 0) continue;

        let matchCount = 0;
        for (const ct of cTokens) {
            if (nodeTokens.some(nt => nt.includes(ct) || ct.includes(nt))) {
                matchCount++;
            }
        }

        const score = matchCount / Math.max(cTokens.length, 1);

        if (matchCount >= 2 && score > bestScore) {
            bestScore = score;
            bestContact = c;
        } else if (matchCount >= 1 && cTokens.length === 1 && score > bestScore && bestScore < 0.8) {
            bestScore = score;
            bestContact = c;
        }
    }

    return bestScore >= 0.5 ? bestContact : null;
}

// ============================================
// HEBREW CALENDAR & BIRTHDAYS MODULE
// ============================================

const HEBREW_MONTH_MAP = {
    'תשרי': 'Tishrei', 'חשון': 'Cheshvan', 'מרחשון': 'Cheshvan', 'כסלו': 'Kislev', 'כסליו': 'Kislev',
    'טבת': 'Tevet', 'שבט': 'Shevat', 'אדר': 'Adar', 'אדר א': 'Adar I', 'אדר ב': 'Adar II',
    'ניסן': 'Nisan', 'אייר': 'Iyyar', 'סיון': 'Sivan', 'סיוון': 'Sivan', 'תמוז': 'Tamuz',
    'אב': 'Av', 'מנחם אב': 'Av', 'אלול': 'Elul'
};

const HEBREW_DAY_LETTERS = [
    '', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י',
    'יא', 'יב', 'יג', 'יד', 'טו', 'טז', 'יז', 'יח', 'יט', 'כ',
    'כא', 'כב', 'כג', 'כד', 'כה', 'כו', 'כז', 'כח', 'כט', 'ל'
];

function formatHebrewDayName(dayNum) {
    if (!dayNum || dayNum < 1 || dayNum > 30) return '';
    const name = HEBREW_DAY_LETTERS[dayNum];
    if (name.length === 1) return `${name}׳`;
    return `${name.slice(0, 1)}״${name.slice(1)}`;
}

function parseHebrewBirthdayString(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let clean = raw.replace(/\(.*?\)/g, '').replace(/['\"״׳״׳]/g, '').trim();
    clean = clean.replace(/\s+/g, ' ');
    if (!clean) return null;

    let foundMonth = null;
    let foundKey = '';
    const monthKeys = Object.keys(HEBREW_MONTH_MAP).sort((a, b) => b.length - a.length);
    for (const k of monthKeys) {
        if (clean.includes(k)) {
            foundMonth = HEBREW_MONTH_MAP[k];
            foundKey = k;
            break;
        }
    }
    if (!foundMonth) return null;

    let dayStr = clean.replace(foundKey, '').trim();
    if (dayStr.startsWith('ב ')) dayStr = dayStr.substring(2).trim();

    const valMap = {'א':1,'ב':2,'ג':3,'ד':4,'ה':5,'ו':6,'ז':7,'ח':8,'ט':9,'י':10,'כ':20,'ל':30};
    let dayNum = 0;
    if (/^\d+$/.test(dayStr)) {
        dayNum = parseInt(dayStr, 10);
    } else {
        for (const char of dayStr) {
            if (valMap[char]) dayNum += valMap[char];
        }
    }

    return {
        raw: raw.trim(),
        month: foundMonth,
        day: dayNum,
        monthHe: foundKey
    };
}

function parseEnglishBirthdayString(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const clean = raw.trim();
    if (!clean) return null;

    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    let foundMonthIdx = -1;
    let foundMonthName = '';

    for (let i = 0; i < months.length; i++) {
        const m = months[i];
        if (clean.toLowerCase().includes(m.toLowerCase()) || clean.toLowerCase().includes(m.substring(0, 3).toLowerCase())) {
            foundMonthIdx = i; // 0-indexed (0=Jan)
            foundMonthName = m;
            break;
        }
    }
    if (foundMonthIdx === -1) return null;

    const dayMatch = clean.match(/(\d{1,2})/);
    const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;

    return {
        raw: clean,
        monthIdx: foundMonthIdx,
        monthName: foundMonthName,
        day: day
    };
}

function getHebrewDateInfo(date) {
    const parts = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);
    const partsHe = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(date);

    const monthPart = parts.find(p => p.type === 'month');
    const dayPart = parts.find(p => p.type === 'day');
    const yearPart = parts.find(p => p.type === 'year');
    const monthHePart = partsHe.find(p => p.type === 'month');

    return {
        month: monthPart ? monthPart.value : '',
        day: dayPart ? parseInt(dayPart.value, 10) : 1,
        year: yearPart ? yearPart.value : '',
        monthHe: monthHePart ? monthHePart.value : ''
    };
}

function matchesHebrewDate(personHDate, targetHDate) {
    if (!personHDate || !personHDate.month || !personHDate.day) return false;
    if (personHDate.day !== targetHDate.day) return false;

    let pMonth = personHDate.month;
    let tMonth = targetHDate.month;

    // Treat Adar I as Adar during regular (non-leap) years
    if (tMonth === 'Adar') {
        if (pMonth === 'Adar I' || pMonth === 'Adar II') {
            pMonth = 'Adar';
        }
    }

    return pMonth === tMonth;
}

function matchesEnglishDate(personEDate, targetDate) {
    if (!personEDate || personEDate.monthIdx < 0 || !personEDate.day) return false;
    return personEDate.monthIdx === targetDate.getMonth() && personEDate.day === targetDate.getDate();
}

function findBirthdayForPerson(personFullName, possibleLastNames = []) {
    if (!personFullName) return null;
    const cleanPerson = personFullName.toLowerCase().replace(/['"&,()]/g, ' ').trim();
    const tokens = cleanPerson.split(/\s+/).filter(t => t.length > 1 && !['and', 'mr', 'mrs', 'dr', 'rabbi', 'spouse'].includes(t));
    if (tokens.length === 0) return null;

    const lastNameCandidates = (possibleLastNames || []).map(l => (l || '').toLowerCase().trim()).filter(Boolean);

    // 1. Exact match on fullName
    for (const b of parsedBirthdays) {
        const bFull = (b.fullName || '').toLowerCase().trim();
        if (bFull && (cleanPerson === bFull || cleanPerson.includes(bFull) || bFull.includes(cleanPerson))) {
            return b;
        }
    }

    // 2. Match First Name + (Last Name token or known branch lastName)
    let bestMatch = null;
    let bestScore = 0;

    for (const b of parsedBirthdays) {
        const bFirst = (b.first || '').toLowerCase().trim();
        const bLast = (b.last || '').toLowerCase().trim();
        if (!bFirst) continue;

        // Check if first name matches any token
        const firstMatches = tokens.some(t => t === bFirst || bFirst.startsWith(t) || t.startsWith(bFirst));
        if (!firstMatches) continue;

        let score = 1;
        // Check if last name matches token or candidate list
        const lastInTokens = tokens.some(t => t === bLast || (bLast && t.includes(bLast)) || (bLast && bLast.includes(t)));
        const lastInCandidates = lastNameCandidates.some(c => c === bLast || (bLast && c.includes(bLast)) || (bLast && bLast.includes(c)));

        if (lastInTokens) score += 3;
        else if (lastInCandidates) score += 2;

        if (score > bestScore) {
            bestScore = score;
            bestMatch = b;
        }
    }

    return bestScore >= 2 ? bestMatch : null;
}

function processBirthdaysCSV(csvText) {
    const list = [];
    if (!csvText) return list;

    const rows = parseCSV(csvText);
    if (rows.length <= 1) return list;

    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || r.length < 2) continue;
        const last = (r[0] || '').trim();
        const first = (r[1] || '').trim();
        const engRaw = (r[2] || '').trim();
        const hebRaw = (r[3] || '').trim();

        if (!first && !last) continue;

        const parsedEng = parseEnglishBirthdayString(engRaw);
        const parsedHeb = parseHebrewBirthdayString(hebRaw);

        list.push({
            last,
            first,
            fullName: `${first} ${last}`.trim(),
            englishRaw: engRaw,
            hebrewRaw: hebRaw,
            englishParsed: parsedEng,
            hebrewParsed: parsedHeb
        });
    }
    return list;
}

async function loadBirthdays() {
    let csvText = null;
    for (const proxyFn of CORS_PROXIES) {
        try {
            csvText = await fetchWithProxy(BIRTHDAYS_EXPORT_URL, proxyFn);
            if (csvText && (csvText.includes('Last') || csvText.includes('Birthday') || csvText.includes('Tendler') || csvText.includes('Charner'))) {
                break;
            }
            csvText = null;
        } catch (e) {
            csvText = null;
        }
    }
    
    // Process live data if available
    const liveList = csvText ? processBirthdaysCSV(csvText) : [];
    // Process fallback data
    const fallbackList = typeof FALLBACK_BIRTHDAYS_CSV !== "undefined" ? processBirthdaysCSV(FALLBACK_BIRTHDAYS_CSV) : [];

    if (liveList.length === 0) {
        parsedBirthdays = fallbackList;
    } else {
        // Merge: use live list as base, but enrich with fallback dates if live row is missing English or Hebrew date
        parsedBirthdays = liveList.map(item => {
            const fb = fallbackList.find(f => 
                (f.last || '').toLowerCase() === (item.last || '').toLowerCase() && 
                (f.first || '').toLowerCase() === (item.first || '').toLowerCase()
            );
            if (fb) {
                const engRaw = item.englishRaw || fb.englishRaw;
                const hebRaw = item.hebrewRaw || fb.hebrewRaw;
                return {
                    ...item,
                    englishRaw: engRaw,
                    hebrewRaw: hebRaw,
                    englishParsed: item.englishParsed || fb.englishParsed,
                    hebrewParsed: item.hebrewParsed || fb.hebrewParsed
                };
            }
            return item;
        });

        // Also add any fallback entries not present in live
        fallbackList.forEach(fb => {
            const exists = parsedBirthdays.some(p => 
                (p.last || '').toLowerCase() === (fb.last || '').toLowerCase() && 
                (p.first || '').toLowerCase() === (fb.first || '').toLowerCase()
            );
            if (!exists) {
                parsedBirthdays.push(fb);
            }
        });
    }
}

function renderBirthdayPopup(triggerUserAction = false) {
    const modal = document.getElementById('birthdays-popup-modal');
    const banner = document.getElementById('bday-popup-today-banner');
    const todayList = document.getElementById('bday-today-list');
    const recentList = document.getElementById('bday-recent-list');
    const upcomingList = document.getElementById('bday-upcoming-list');

    if (!modal || !todayList || !recentList || !upcomingList) return;

    const now = new Date();
    const todayHDate = getHebrewDateInfo(now);
    const enTodayStr = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const heTodayStr = `${formatHebrewDayName(todayHDate.day)} ${todayHDate.monthHe || todayHDate.month} ${todayHDate.year}`;

    if (banner) {
        banner.textContent = `Today: ${enTodayStr} • ${heTodayStr}`;
    }

    const todayMatches = [];
    const recentMatches = [];
    const upcomingMatches = [];

    parsedBirthdays.forEach(person => {
        if (!person.englishParsed && !person.hebrewParsed) return;

        // 1. Check Today
        let isTodayEng = matchesEnglishDate(person.englishParsed, now);
        let isTodayHeb = matchesHebrewDate(person.hebrewParsed, todayHDate);
        if (isTodayEng || isTodayHeb) {
            todayMatches.push({
                person,
                reason: isTodayHeb && isTodayEng ? 'Hebrew & English Today' : isTodayHeb ? 'Hebrew Birthday Today' : 'English Birthday Today'
            });
            return;
        }

        // 2. Check Last 7 Days (Days -1 to -7)
        for (let diff = 1; diff <= 7; diff++) {
            const pastDate = new Date(now.getTime() - diff * 86400000);
            const pastHDate = getHebrewDateInfo(pastDate);
            const isPastEng = matchesEnglishDate(person.englishParsed, pastDate);
            const isPastHeb = matchesHebrewDate(person.hebrewParsed, pastHDate);
            if (isPastEng || isPastHeb) {
                const daysAgoStr = diff === 1 ? '1 day ago' : `${diff} days ago`;
                recentMatches.push({
                    person,
                    diff: -diff,
                    daysAgoStr,
                    reason: isPastHeb && isPastEng ? `Hebrew & English (${daysAgoStr})` : isPastHeb ? `Hebrew (${daysAgoStr})` : `English (${daysAgoStr})`
                });
                return;
            }
        }

        // 3. Check Next 7 Days (Days +1 to +7)
        for (let diff = 1; diff <= 7; diff++) {
            const futureDate = new Date(now.getTime() + diff * 86400000);
            const futureHDate = getHebrewDateInfo(futureDate);
            const isFutEng = matchesEnglishDate(person.englishParsed, futureDate);
            const isFutHeb = matchesHebrewDate(person.hebrewParsed, futureHDate);
            if (isFutEng || isFutHeb) {
                const inDaysStr = diff === 1 ? 'Tomorrow' : `in ${diff} days`;
                upcomingMatches.push({
                    person,
                    diff,
                    inDaysStr,
                    reason: isFutHeb && isFutEng ? `Hebrew & English (${inDaysStr})` : isFutHeb ? `Hebrew (${inDaysStr})` : `English (${inDaysStr})`
                });
                return;
            }
        }
    });

    // Populate Today's List
    if (todayMatches.length > 0) {
        todayList.innerHTML = todayMatches.map(m => `
            <div class="bday-item today-item">
                <div class="bday-name">🎂 ${escapeHtml(m.person.fullName)}</div>
                <div class="bday-tags">
                    <span class="bday-badge gold">${escapeHtml(m.reason)}</span>
                    ${m.person.hebrewRaw ? `<span class="bday-badge">${escapeHtml(m.person.hebrewRaw)}</span>` : ''}
                    ${m.person.englishRaw ? `<span class="bday-badge">${escapeHtml(m.person.englishRaw)}</span>` : ''}
                </div>
            </div>
        `).join('');
    } else {
        todayList.innerHTML = '<p class="bday-empty">No birthdays today.</p>';
    }

    // Populate Recent List
    if (recentMatches.length > 0) {
        recentMatches.sort((a, b) => b.diff - a.diff); // closer days first
        recentList.innerHTML = recentMatches.map(m => `
            <div class="bday-item">
                <div class="bday-name">${escapeHtml(m.person.fullName)}</div>
                <div class="bday-tags">
                    <span class="bday-badge">${escapeHtml(m.reason)}</span>
                    ${m.person.hebrewRaw ? `<span class="bday-badge">${escapeHtml(m.person.hebrewRaw)}</span>` : ''}
                    ${m.person.englishRaw ? `<span class="bday-badge">${escapeHtml(m.person.englishRaw)}</span>` : ''}
                </div>
            </div>
        `).join('');
    } else {
        recentList.innerHTML = '<p class="bday-empty">No birthdays in the last 7 days.</p>';
    }

    // Populate Upcoming List
    if (upcomingMatches.length > 0) {
        upcomingMatches.sort((a, b) => a.diff - b.diff);
        upcomingList.innerHTML = upcomingMatches.map(m => `
            <div class="bday-item">
                <div class="bday-name">${escapeHtml(m.person.fullName)}</div>
                <div class="bday-tags">
                    <span class="bday-badge">${escapeHtml(m.reason)}</span>
                    ${m.person.hebrewRaw ? `<span class="bday-badge">${escapeHtml(m.person.hebrewRaw)}</span>` : ''}
                    ${m.person.englishRaw ? `<span class="bday-badge">${escapeHtml(m.person.englishRaw)}</span>` : ''}
                </div>
            </div>
        `).join('');
    } else {
        upcomingList.innerHTML = '<p class="bday-empty">No birthdays in the next 7 days.</p>';
    }

    // Only show automatically on page load if there are birthdays today or recent/upcoming, or when triggered by button
    if (triggerUserAction || todayMatches.length > 0 || recentMatches.length > 0 || upcomingMatches.length > 0) {
        modal.style.display = 'flex';
    }
}

function setupBirthdayPopup() {
    const btn = document.getElementById('birthdays-btn');
    const modal = document.getElementById('birthdays-popup-modal');
    const overlay = document.getElementById('bday-popup-overlay');
    const closeBtn = document.getElementById('bday-popup-close');
    const dismissBtn = document.getElementById('bday-popup-dismiss');

    if (btn) {
        btn.addEventListener('click', () => {
            renderBirthdayPopup(true);
        });
    }

    const hide = () => {
        if (modal) modal.style.display = 'none';
    };

    if (overlay) overlay.addEventListener('click', hide);
    if (closeBtn) closeBtn.addEventListener('click', hide);
    if (dismissBtn) dismissBtn.addEventListener('click', hide);
}

// ============================================
// DYNAMIC FULL-YEAR & MONTHLY CALENDAR ENGINE
// ============================================

/**
 * Standard Jewish, US, and Israeli holiday catalog with accurate date algorithms.
 */
const JEWISH_HOLIDAYS_FIXED_HEBREW = [
    { month: 'Tishrei', day: 1, name: 'Rosh Hashana I', he: 'ראש השנה א׳', type: 'jewish' },
    { month: 'Tishrei', day: 2, name: 'Rosh Hashana II', he: 'ראש השנה ב׳', type: 'jewish' },
    { month: 'Tishrei', day: 3, name: 'Tzom Gedaliah', he: 'צום גדליה', type: 'jewish' },
    { month: 'Tishrei', day: 10, name: 'Yom Kippur', he: 'יום כיפור', type: 'jewish' },
    { month: 'Tishrei', day: 15, name: 'Sukkot I', he: 'סוכות א׳', type: 'jewish' },
    { month: 'Tishrei', day: 16, name: 'Sukkot II', he: 'סוכות ב׳', type: 'jewish' },
    { month: 'Tishrei', day: 17, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 18, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 19, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 20, name: 'Chol HaMoed Sukkot', he: 'חוה״מ סוכות', type: 'jewish' },
    { month: 'Tishrei', day: 21, name: 'Hoshana Rabba', he: 'הושענא רבה', type: 'jewish' },
    { month: 'Tishrei', day: 22, name: 'Shemini Atzeret', he: 'שמיני עצרת', type: 'jewish' },
    { month: 'Tishrei', day: 23, name: 'Simchat Torah', he: 'שמחת תורה', type: 'jewish' },
    { month: 'Kislev', day: 25, name: 'Chanukah I', he: 'חנוכה א׳', type: 'jewish' },
    { month: 'Kislev', day: 26, name: 'Chanukah II', he: 'חנוכה ב׳', type: 'jewish' },
    { month: 'Kislev', day: 27, name: 'Chanukah III', he: 'חנוכה ג׳', type: 'jewish' },
    { month: 'Kislev', day: 28, name: 'Chanukah IV', he: 'חנוכה ד׳', type: 'jewish' },
    { month: 'Kislev', day: 29, name: 'Chanukah V', he: 'חנוכה ה׳', type: 'jewish' },
    { month: 'Kislev', day: 30, name: 'Chanukah VI', he: 'חנוכה ו׳', type: 'jewish' },
    { month: 'Tevet', day: 1, name: 'Chanukah VII', he: 'חנוכה ז׳', type: 'jewish' },
    { month: 'Tevet', day: 2, name: 'Chanukah VIII', he: 'חנוכה ח׳', type: 'jewish' },
    { month: 'Tevet', day: 10, name: 'Asara B\'Tevet (Fast)', he: 'עשרה בטבת', type: 'jewish' },
    { month: 'Shevat', day: 15, name: 'Tu BiShvat', he: 'ט״ו בשבט', type: 'jewish' },
    { month: 'Adar', day: 13, name: 'Ta\'anit Esther', he: 'תענית אסתר', type: 'jewish' },
    { month: 'Adar', day: 14, name: 'Purim', he: 'פורים', type: 'jewish' },
    { month: 'Adar', day: 15, name: 'Shushan Purim', he: 'שושן פורים', type: 'jewish' },
    { month: 'Adar II', day: 13, name: 'Ta\'anit Esther', he: 'תענית אסתר', type: 'jewish' },
    { month: 'Adar II', day: 14, name: 'Purim', he: 'פורים', type: 'jewish' },
    { month: 'Adar II', day: 15, name: 'Shushan Purim', he: 'שושן פורים', type: 'jewish' },
    { month: 'Nisan', day: 14, name: 'Erev Pesach', he: 'ערב פסח', type: 'jewish' },
    { month: 'Nisan', day: 15, name: 'Pesach I', he: 'פסח א׳', type: 'jewish' },
    { month: 'Nisan', day: 16, name: 'Pesach II', he: 'פסח ב׳', type: 'jewish' },
    { month: 'Nisan', day: 17, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 18, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 19, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 20, name: 'Chol HaMoed Pesach', he: 'חוה״מ פסח', type: 'jewish' },
    { month: 'Nisan', day: 21, name: 'Pesach VII', he: 'שביעי של פסח', type: 'jewish' },
    { month: 'Nisan', day: 22, name: 'Pesach VIII', he: 'אחרון של פסח', type: 'jewish' },
    { month: 'Nisan', day: 27, name: 'Yom HaShoah', he: 'יום השואה', type: 'jewish' },
    { month: 'Iyyar', day: 4, name: 'Yom HaZikaron', he: 'יום הזיכרון', type: 'israel' },
    { month: 'Iyyar', day: 5, name: 'Yom HaAtzmaut', he: 'יום העצמאות', type: 'israel' },
    { month: 'Iyyar', day: 18, name: 'Lag BaOmer', he: 'ל״ג בעומר', type: 'jewish' },
    { month: 'Iyyar', day: 28, name: 'Yom Yerushalayim', he: 'יום ירושלים', type: 'israel' },
    { month: 'Sivan', day: 6, name: 'Shavuot I', he: 'שבועות א׳', type: 'jewish' },
    { month: 'Sivan', day: 7, name: 'Shavuot II', he: 'שבועות ב׳', type: 'jewish' },
    { month: 'Tamuz', day: 17, name: 'Shiva Asar B\'Tammuz (Fast)', he: 'י״ז בתמוז', type: 'jewish' },
    { month: 'Av', day: 9, name: 'Tisha B\'Av (Fast)', he: 'תשעה באב', type: 'jewish' },
    { month: 'Av', day: 15, name: 'Tu B\'Av', he: 'ט״ו באב', type: 'jewish' }
];

function getUSHolidaysForYear(year) {
    const list = [];
    // Fixed dates
    list.push({ monthIdx: 0, day: 1, name: 'New Year\'s Day', type: 'us' });
    list.push({ monthIdx: 5, day: 19, name: 'Juneteenth', type: 'us' });
    list.push({ monthIdx: 6, day: 4, name: 'Independence Day', type: 'us' });
    list.push({ monthIdx: 10, day: 11, name: 'Veterans Day', type: 'us' });
    list.push({ monthIdx: 11, day: 25, name: 'Christmas Day', type: 'us' });

    // Floating US Holidays
    const getNthWeekday = (mIdx, targetDayOfWeek, n) => {
        let count = 0;
        for (let d = 1; d <= 31; d++) {
            const date = new Date(year, mIdx, d);
            if (date.getMonth() !== mIdx) break;
            if (date.getDay() === targetDayOfWeek) {
                count++;
                if (count === n) return d;
            }
        }
        return null;
    };

    const getLastWeekday = (mIdx, targetDayOfWeek) => {
        let lastDay = 1;
        for (let d = 1; d <= 31; d++) {
            const date = new Date(year, mIdx, d);
            if (date.getMonth() !== mIdx) break;
            if (date.getDay() === targetDayOfWeek) lastDay = d;
        }
        return lastDay;
    };

    // MLK Day: 3rd Monday in Jan
    list.push({ monthIdx: 0, day: getNthWeekday(0, 1, 3), name: 'MLK Day', type: 'us' });
    // Presidents' Day: 3rd Monday in Feb
    list.push({ monthIdx: 1, day: getNthWeekday(1, 1, 3), name: 'Presidents\' Day', type: 'us' });
    // Memorial Day: Last Monday in May
    list.push({ monthIdx: 4, day: getLastWeekday(4, 1), name: 'Memorial Day', type: 'us' });
    // Labor Day: 1st Monday in Sept
    list.push({ monthIdx: 8, day: getNthWeekday(8, 1, 1), name: 'Labor Day', type: 'us' });
    // Columbus / Indigenous Peoples' Day: 2nd Monday in Oct
    list.push({ monthIdx: 9, day: getNthWeekday(9, 1, 2), name: 'Columbus Day', type: 'us' });
    // Thanksgiving: 4th Thursday in Nov
    list.push({ monthIdx: 10, day: getNthWeekday(10, 4, 4), name: 'Thanksgiving', type: 'us' });

    return list;
}

let calendarState = {
    year: new Date().getFullYear(),
    monthIdx: new Date().getMonth(),
    viewMode: 'year' // 'year' | 'month'
};

function renderCalendarEngine() {
    const container = document.getElementById('calendar-content-area');
    if (!container) return;

    container.innerHTML = '';
    const targetYear = calendarState.year;
    const usHolidays = getUSHolidaysForYear(targetYear);

    const monthsToRender = calendarState.viewMode === 'year'
        ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
        : [calendarState.monthIdx];

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Shabbat'];

    monthsToRender.forEach(mIdx => {
        const monthSheet = document.createElement('div');
        monthSheet.className = 'calendar-month-sheet';

        const firstDate = new Date(targetYear, mIdx, 1);
        const lastDate = new Date(targetYear, mIdx + 1, 0);
        const totalDays = lastDate.getDate();
        const startDayOfWeek = firstDate.getDay(); // 0=Sun..6=Sat

        // Header for month
        const firstHDate = getHebrewDateInfo(firstDate);
        const lastHDate = getHebrewDateInfo(lastDate);
        const hebrewMonthRange = firstHDate.monthHe === lastHDate.monthHe
            ? `${firstHDate.monthHe} ${firstHDate.year}`
            : `${firstHDate.monthHe} – ${lastHDate.monthHe} ${firstHDate.year}`;

        monthSheet.innerHTML = `
            <div class="calendar-month-header">
                <div class="cal-month-title-group">
                    <div class="cal-month-title">${monthNames[mIdx]} ${targetYear}</div>
                    <div class="cal-hebrew-month-subtitle">${hebrewMonthRange}</div>
                </div>
                <div class="cal-month-legend-inline">
                    <span class="cal-event-tag cal-badge-hebrew-bday">Hebrew Birthday</span>
                    <span class="cal-event-tag cal-badge-english-bday">English Birthday</span>
                    <span class="cal-event-tag cal-badge-jewish-holiday">Jewish Holiday</span>
                    <span class="cal-event-tag cal-badge-us-holiday">US Holiday</span>
                    <span class="cal-event-tag cal-badge-israel-holiday">Israel Holiday</span>
                    <span class="cal-event-tag cal-badge-rosh-chodesh">Rosh Chodesh</span>
                </div>
            </div>
            <table class="calendar-grid-table">
                <thead>
                    <tr>
                        ${weekdayNames.map(w => `<th>${w}</th>`).join('')}
                    </tr>
                </thead>
                <tbody id="cal-tbody-${mIdx}"></tbody>
            </table>
        `;

        const tbody = monthSheet.querySelector(`#cal-tbody-${mIdx}`);
        let currentDay = 1;
        let weekRow = document.createElement('tr');

        // Leading empty cells from previous month
        for (let i = 0; i < startDayOfWeek; i++) {
            const prevMonthLastDay = new Date(targetYear, mIdx, 0).getDate();
            const dayNum = prevMonthLastDay - startDayOfWeek + i + 1;
            const td = document.createElement('td');
            td.className = 'cal-other-month';
            td.innerHTML = `<div class="cal-day-header"><span class="cal-secular-date">${dayNum}</span></div>`;
            weekRow.appendChild(td);
        }

        const today = new Date();
        const isCurrentRealMonth = today.getFullYear() === targetYear && today.getMonth() === mIdx;

        while (currentDay <= totalDays) {
            if (weekRow.children.length === 7) {
                tbody.appendChild(weekRow);
                weekRow = document.createElement('tr');
            }

            const thisDate = new Date(targetYear, mIdx, currentDay);
            const hDate = getHebrewDateInfo(thisDate);
            const td = document.createElement('td');

            if (isCurrentRealMonth && today.getDate() === currentDay) {
                td.classList.add('cal-today');
            }

            // Events on this day
            const events = [];

            // 1. Rosh Chodesh
            if (hDate.day === 1 || hDate.day === 30) {
                events.push({
                    text: hDate.day === 1 ? `ר״ח ${hDate.monthHe}` : 'ר״ח',
                    type: 'rosh-chodesh',
                    badgeClass: 'cal-badge-rosh-chodesh'
                });
            }

            // 2. Jewish / Israeli Holidays
            JEWISH_HOLIDAYS_FIXED_HEBREW.forEach(jh => {
                if (matchesHebrewDate(jh, hDate)) {
                    events.push({
                        text: jh.name,
                        type: jh.type,
                        badgeClass: jh.type === 'israel' ? 'cal-badge-israel-holiday' : 'cal-badge-jewish-holiday'
                    });
                }
            });

            // 3. US Federal Holidays
            usHolidays.forEach(uh => {
                if (uh.monthIdx === mIdx && uh.day === currentDay) {
                    events.push({
                        text: uh.name,
                        type: 'us',
                        badgeClass: 'cal-badge-us-holiday'
                    });
                }
            });

            // 4. Family Birthdays (Hebrew & English)
            (parsedBirthdays || []).forEach(b => {
                // English Birthday match
                if (matchesEnglishDate(b.englishParsed, thisDate)) {
                    events.push({
                        text: `🎂 ${b.first} ${b.last}`,
                        type: 'english-bday',
                        badgeClass: 'cal-badge-english-bday'
                    });
                }
                // Hebrew Birthday match
                if (matchesHebrewDate(b.hebrewParsed, hDate)) {
                    events.push({
                        text: `📜 ${b.first} ${b.last}`,
                        type: 'hebrew-bday',
                        badgeClass: 'cal-badge-hebrew-bday'
                    });
                }
            });

            // Render Day Cell
            const hebrewDayStr = formatHebrewDayName(hDate.day);
            td.innerHTML = `
                <div class="cal-day-header">
                    <span class="cal-secular-date">${currentDay}</span>
                    <span class="cal-hebrew-date">${hebrewDayStr}</span>
                </div>
                <div class="cal-events-container">
                    ${events.map(ev => `<span class="cal-event-tag ${ev.badgeClass}" title="${escapeHtml(ev.text)}">${escapeHtml(ev.text)}</span>`).join('')}
                </div>
            `;

            weekRow.appendChild(td);
            currentDay++;
        }

        // Trailing empty cells for next month
        let nextMonthDay = 1;
        while (weekRow.children.length < 7 && weekRow.children.length > 0) {
            const td = document.createElement('td');
            td.className = 'cal-other-month';
            td.innerHTML = `<div class="cal-day-header"><span class="cal-secular-date">${nextMonthDay++}</span></div>`;
            weekRow.appendChild(td);
        }
        if (weekRow.children.length > 0) {
            tbody.appendChild(weekRow);
        }

        container.appendChild(monthSheet);
    });
}

function setupCalendarModal() {
    const btn = document.getElementById('calendar-btn');
    const modal = document.getElementById('calendar-modal');
    const overlay = document.getElementById('calendar-modal-overlay');
    const closeBtn = document.getElementById('calendar-modal-close');
    const dismissBtn = document.getElementById('calendar-modal-dismiss');
    const yearSelect = document.getElementById('cal-year-select');
    const viewSelect = document.getElementById('cal-view-select');
    const monthSelect = document.getElementById('cal-month-select');
    const monthContainer = document.getElementById('cal-month-select-container');
    const prevMonthBtn = document.getElementById('cal-prev-month');
    const nextMonthBtn = document.getElementById('cal-next-month');
    const printBtn = document.getElementById('cal-print-btn');

    if (!btn || !modal) return;

    // Populate Year Select Options: [Current - 1, Current, Current + 1, Current + 2]
    const curYear = new Date().getFullYear();
    yearSelect.innerHTML = `
        <option value="${curYear - 1}">${curYear - 1}</option>
        <option value="${curYear}" selected>${curYear}</option>
        <option value="${curYear + 1}">${curYear + 1}</option>
        <option value="${curYear + 2}">${curYear + 2}</option>
    `;
    monthSelect.value = new Date().getMonth();

    const openCalendar = () => {
        calendarState.year = parseInt(yearSelect.value, 10) || curYear;
        calendarState.monthIdx = parseInt(monthSelect.value, 10) || 0;
        calendarState.viewMode = viewSelect.value || 'year';
        renderCalendarEngine();
        modal.style.display = 'flex';
    };

    const hideCalendar = () => {
        modal.style.display = 'none';
    };

    btn.addEventListener('click', openCalendar);
    if (overlay) overlay.addEventListener('click', hideCalendar);
    if (closeBtn) closeBtn.addEventListener('click', hideCalendar);
    if (dismissBtn) dismissBtn.addEventListener('click', hideCalendar);

    yearSelect.addEventListener('change', () => {
        calendarState.year = parseInt(yearSelect.value, 10);
        renderCalendarEngine();
    });

    viewSelect.addEventListener('change', () => {
        calendarState.viewMode = viewSelect.value;
        if (monthContainer) {
            monthContainer.style.display = calendarState.viewMode === 'month' ? 'flex' : 'none';
        }
        renderCalendarEngine();
    });

    monthSelect.addEventListener('change', () => {
        calendarState.monthIdx = parseInt(monthSelect.value, 10);
        renderCalendarEngine();
    });

    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', () => {
            if (calendarState.monthIdx > 0) {
                calendarState.monthIdx--;
            } else {
                calendarState.monthIdx = 11;
                calendarState.year--;
                yearSelect.value = calendarState.year;
            }
            monthSelect.value = calendarState.monthIdx;
            renderCalendarEngine();
        });
    }

    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', () => {
            if (calendarState.monthIdx < 11) {
                calendarState.monthIdx++;
            } else {
                calendarState.monthIdx = 0;
                calendarState.year++;
                yearSelect.value = calendarState.year;
            }
            monthSelect.value = calendarState.monthIdx;
            renderCalendarEngine();
        });
    }

    // Print / Landscape PDF Action
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            window.print();
        });
    }
}

function getBirthdaysForNode(node) {
    if (!node) return [];
    const results = [];

    // Derive possible last names for this branch/person
    const nameParts = (node.name || '').trim().split(/\s+/);
    const branchLastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
    const possibleLastNames = [branchLastName, 'Tendler', 'Fried', 'Oren', 'Rappaport', 'Leibowitz', 'Kreiger', 'Bohorodzaner', 'Charner', 'Rosner', 'Kaufman', 'Recht', 'Shoff', 'Shub', 'Schiller', 'Goldman', 'Groll', 'Warn', 'Donaty', 'Bitter', 'Rosensweig', 'Krumbein', 'Ben-Dovid', 'Ben-David', 'Shrem', 'Paley', 'Gefen', 'Ishon', 'Kazarnovsky', 'Jacobowitz'].filter(Boolean);

    // 1. Primary person
    const b1 = findBirthdayForPerson(node.name, possibleLastNames);
    if (b1 && (b1.englishRaw || b1.hebrewRaw)) {
        results.push({ name: node.name, role: 'primary', data: b1 });
    }

    // 2. Spouse (if married)
    if (node.spouseName) {
        const spouseLastNames = [node.maidenName, branchLastName, ...possibleLastNames].filter(Boolean);
        const b2 = findBirthdayForPerson(node.spouseName, spouseLastNames);
        if (b2 && (b2.englishRaw || b2.hebrewRaw) && (!b1 || b2 !== b1)) {
            results.push({ name: node.spouseName, role: 'spouse', data: b2 });
        }
    }

    return results;
}

function showPersonBirthdayModal(node) {
    const modal = document.getElementById('person-birthday-modal');
    const titleEl = document.getElementById('person-bday-title');
    const subtitleEl = document.getElementById('person-bday-subtitle');
    const bodyEl = document.getElementById('person-bday-body');

    if (!modal || !bodyEl) return;

    const bdays = getBirthdaysForNode(node);
    let displayName = node.name;
    if (node.spouseName) displayName += ` & ${node.spouseName}`;

    titleEl.textContent = '🎂 Birthday Information';
    subtitleEl.textContent = `Birthdays for ${displayName}`;

    if (bdays.length === 0) {
        bodyEl.innerHTML = `
            <div style="text-align: center; padding: 1.5rem 0.5rem;">
                <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📅</div>
                <p style="color: var(--text-primary); font-weight: 500;">No birthday on record yet for ${escapeHtml(displayName)}.</p>
                <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">You can add their birthday using the <strong>Add Member</strong> button above.</p>
            </div>
        `;
    } else {
        bodyEl.innerHTML = bdays.map(item => `
            <div class="bday-section" style="margin-bottom: 0.75rem;">
                <h4 class="bday-section-title" style="color: var(--gold-200); font-size: 1rem;">
                    👤 ${escapeHtml(item.name)} ${item.role === 'spouse' ? '<span style="font-size: 0.8rem; opacity: 0.7; font-weight: normal;">(Spouse)</span>' : ''}
                </h4>
                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;">
                        <span>🎂 <strong>English:</strong></span>
                        <span style="color: var(--text-primary);">${item.data.englishRaw ? escapeHtml(item.data.englishRaw) : '<span style="color:var(--text-muted); font-style:italic;">Not listed</span>'}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem;">
                        <span>📜 <strong>Hebrew:</strong></span>
                        <span style="color: var(--gold-200); font-weight: 500;">${item.data.hebrewRaw ? escapeHtml(item.data.hebrewRaw) : '<span style="color:var(--text-muted); font-style:italic;">Not listed</span>'}</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    modal.style.display = 'flex';
}

function hidePersonBirthdayModal() {
    const modal = document.getElementById('person-birthday-modal');
    if (modal) modal.style.display = 'none';
}

function setupPersonBirthdayModal() {
    const overlay = document.getElementById('person-bday-overlay');
    const closeBtn = document.getElementById('person-bday-close');
    const dismissBtn = document.getElementById('person-bday-dismiss');

    if (overlay) overlay.addEventListener('click', hidePersonBirthdayModal);
    if (closeBtn) closeBtn.addEventListener('click', hidePersonBirthdayModal);
    if (dismissBtn) dismissBtn.addEventListener('click', hidePersonBirthdayModal);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hidePersonBirthdayModal();
        }
    });
}

function setupContactModal() {
    const overlay = document.getElementById('contact-modal-overlay');
    const closeBtn = document.getElementById('contact-modal-close');
    const dismissBtn = document.getElementById('contact-modal-dismiss');
    
    if (overlay) overlay.addEventListener('click', hideContactModal);
    if (closeBtn) closeBtn.addEventListener('click', hideContactModal);
    if (dismissBtn) dismissBtn.addEventListener('click', hideContactModal);
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideContactModal();
        }
    });
}

function showContactModal(contact, nodeDisplayName) {
    const modal = document.getElementById('contact-modal');
    const titleEl = document.getElementById('contact-modal-title');
    const subtitleEl = document.getElementById('contact-modal-subtitle');
    const addrContainer = document.getElementById('contact-field-address');
    const addrText = document.getElementById('contact-address-text');
    const emailContainer = document.getElementById('contact-field-email');
    const emailLinks = document.getElementById('contact-email-links');
    const bdayContainer = document.getElementById('contact-field-birthday');
    const bdayText = document.getElementById('contact-birthday-text');
    const hebrewBdayContainer = document.getElementById('contact-field-hebrew-birthday');
    const hebrewBdayText = document.getElementById('contact-hebrew-birthday-text');

    if (!modal) return;

    const headerTitle = contact.title && contact.title.trim() 
        ? `${contact.title} ${contact.first} ${contact.last}` 
        : `${contact.first} ${contact.last}`;
        
    titleEl.textContent = headerTitle;
    subtitleEl.textContent = `Contact Info for ${nodeDisplayName || contact.last}`;

    // Find birthday info for this contact/person
    const bdayMatch = findBirthdayForPerson(nodeDisplayName || (contact.first + ' ' + contact.last), contact);
    if (bdayMatch && bdayMatch.englishRaw) {
        bdayText.textContent = bdayMatch.englishRaw;
        if (bdayContainer) bdayContainer.style.display = 'flex';
    } else if (bdayContainer) {
        bdayContainer.style.display = 'none';
    }

    if (bdayMatch && bdayMatch.hebrewRaw) {
        hebrewBdayText.textContent = bdayMatch.hebrewRaw;
        if (hebrewBdayContainer) hebrewBdayContainer.style.display = 'flex';
    } else if (hebrewBdayContainer) {
        hebrewBdayContainer.style.display = 'none';
    }

    const addrParts = [contact.street, contact.city, contact.state, contact.zip].filter(Boolean);

    if (addrParts.length > 0) {
        addrText.textContent = addrParts.join(', ');
        addrContainer.style.display = 'flex';
    } else {
        addrContainer.style.display = 'none';
    }

    if (contact.emails && contact.emails.length > 0) {
        emailLinks.innerHTML = contact.emails
            .map(email => `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`)
            .join('<br>');
        emailContainer.style.display = 'flex';
    } else {
        emailContainer.style.display = 'none';
    }

    modal.style.display = 'flex';
}

function hideContactModal() {
    const modal = document.getElementById('contact-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showBHModal() {
    const modal = document.getElementById('bh-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function updateAllCounts() {
    // 1. Top header total stat
    const totalStatEl = document.getElementById('stat-total-number');
    if (totalStatEl) {
        if (isCountRevealed) {
            animateNumber('stat-total-number', totalMemberCount);
        } else {
            totalStatEl.textContent = 'B"H';
        }
    }
    
    // 2. All descendant count buttons across all levels
    document.querySelectorAll('.child-count').forEach(btn => {
        const count = btn.dataset.count;
        if (!count) return;
        const plural = count !== '1' ? 's' : '';
        if (isCountRevealed) {
            btn.textContent = `${count} descendant${plural}`;
            btn.classList.add('revealed');
        } else {
            btn.textContent = `B"H descendant${plural}`;
            btn.classList.remove('revealed');
        }
    });

    // 3. All branch sibling order badges across all levels
    document.querySelectorAll('.branch-number').forEach(el => {
        const rawNum = el.dataset.number;
        if (isCountRevealed) {
            el.textContent = rawNum || '•';
        } else {
            el.textContent = '•';
        }
    });
}

function setupBHPrompt() {
    const statTotal = document.getElementById('stat-total');
    const modal = document.getElementById('bh-modal');
    const overlay = document.getElementById('bh-modal-overlay');
    const closeBtn = document.getElementById('bh-modal-close');
    const keepBlessedBtn = document.getElementById('bh-keep-blessed-btn');
    const revealBtn = document.getElementById('bh-reveal-btn');

    if (statTotal) {
        statTotal.addEventListener('click', showBHModal);
    }

    const hideBHModal = () => {
        if (modal) modal.style.display = 'none';
    };

    if (overlay) overlay.addEventListener('click', hideBHModal);
    if (closeBtn) closeBtn.addEventListener('click', hideBHModal);

    if (keepBlessedBtn) {
        keepBlessedBtn.addEventListener('click', () => {
            isCountRevealed = false;
            updateAllCounts();
            hideBHModal();
        });
    }

    if (revealBtn) {
        revealBtn.addEventListener('click', () => {
            isCountRevealed = true;
            updateAllCounts();
            hideBHModal();
        });
    }

}

let currentTreeData = null;

function getAllNodes(root) {
    if (!root) return [];
    const list = [];
    function traverse(node) {
        list.push(node);
        if (node.children) {
            node.children.forEach(traverse);
        }
    }
    traverse(root);
    return list;
}

function setupAddMemberModal() {
    const addBtn = document.getElementById('add-member-btn');
    const modal = document.getElementById('add-member-modal');
    const overlay = document.getElementById('add-modal-overlay');
    const closeBtn = document.getElementById('add-modal-close');
    const cancelBtn = document.getElementById('add-modal-cancel');
    const form = document.getElementById('add-member-form');
    const addTypeSelect = document.getElementById('add-type');
    const parentSearch = document.getElementById('parent-search');
    const parentDropdown = document.getElementById('parent-search-dropdown');
    const parentHidden = document.getElementById('parent-select-value');
    const parentDisplay = document.getElementById('parent-selected-display');
    const parentSelectLabel = document.getElementById('parent-select-label');
    const lastNameLabel = document.getElementById('last-name-label');
    const resultBox = document.getElementById('add-result-box');
    const doneBtn = document.getElementById('add-result-done');
    const bdayMonth = document.getElementById('bday-month');
    const bdayDay = document.getElementById('bday-day');
    const bdayYear = document.getElementById('bday-year');
    const bdayHebrewDay = document.getElementById('bday-hebrew-day');
    const bdayHebrewMonth = document.getElementById('bday-hebrew-month');
    const submitStatus = document.getElementById('submit-status');
    const spouseOnlyFields = document.querySelectorAll('.spouse-only-field');

    if (!addBtn || !modal) return;

    // --- Populate birthday day & year dropdowns ---
    if (bdayDay && bdayDay.options.length <= 1) {
        for (let d = 1; d <= 31; d++) {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            bdayDay.appendChild(opt);
        }
    }
    if (bdayYear && bdayYear.options.length <= 1) {
        const currentYear = new Date().getFullYear();
        for (let y = currentYear; y >= 1920; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            bdayYear.appendChild(opt);
        }
    }

    function getBirthdayString() {
        if (!bdayMonth || !bdayDay) return '';
        const m = bdayMonth.value;
        const d = bdayDay.value;
        const y = bdayYear ? bdayYear.value : '';
        if (!m && !d && !y) return '';
        let parts = [];
        if (m) parts.push(m);
        if (d) parts.push(d + ',');
        if (y) parts.push(y);
        return parts.join(' ').replace(/, ?$/, '');
    }

    function getHebrewBirthdayString() {
        if (!bdayHebrewDay || !bdayHebrewMonth) return '';
        const dVal = bdayHebrewDay.value;
        const mVal = bdayHebrewMonth.value;
        if (!dVal && !mVal) return '';
        const dText = dVal ? formatHebrewDayName(parseHebrewBirthdayString(dVal + ' ' + (mVal || 'תשרי'))?.day || 1) : '';
        return [dText, mVal].filter(Boolean).join(' ');
    }

    // --- Toggle spouse-only fields ---
    function updateFieldVisibility() {
        const isSpouse = addTypeSelect.value === 'spouse';
        spouseOnlyFields.forEach(el => {
            if (isSpouse) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });
    }

    // --- Parent search ---
    let parentOptions = [];

    function buildParentOptions() {
        const allNodes = getAllNodes(currentTreeData);
        parentOptions = [];
        const isSpouse = addTypeSelect.value === 'spouse';
        parentSelectLabel.textContent = isSpouse ? 'Who are they joining?' : 'Select Parent(s):';
        lastNameLabel.textContent = isSpouse ? 'New Spouse\'s Last Name / Maiden Name' : 'Last Name (Optional)';

        allNodes.forEach((node, idx) => {
            if (isSpouse) {
                if (!node.spouseName) {
                    parentOptions.push({ idx, label: node.name, node });
                }
            } else {
                let label = node.name;
                if (node.spouseName) label += ` & ${node.spouseName}`;
                parentOptions.push({ idx, label, node });
            }
        });
    }

    function renderDropdown(query) {
        parentDropdown.innerHTML = '';
        const q = (query || '').toLowerCase().trim();
        const filtered = q ? parentOptions.filter(o => o.label.toLowerCase().includes(q)) : parentOptions;

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'ps-option';
            empty.textContent = q ? 'No matches found' : 'No members available';
            empty.style.opacity = '0.5';
            empty.style.cursor = 'default';
            parentDropdown.appendChild(empty);
        } else {
            filtered.forEach(opt => {
                const div = document.createElement('div');
                div.className = 'ps-option';
                div.textContent = opt.label;
                div.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    selectParent(opt);
                });
                parentDropdown.appendChild(div);
            });
        }
        parentDropdown.style.display = 'block';
    }

    function selectParent(opt) {
        parentHidden.value = opt.idx;
        parentSearch.value = '';
        parentDropdown.style.display = 'none';
        parentDisplay.innerHTML = `<span>${opt.label}</span><span class="ps-clear" title="Clear selection">✕</span>`;
        parentDisplay.style.display = 'inline-flex';
        parentSearch.style.display = 'none';
        parentDisplay.querySelector('.ps-clear').addEventListener('click', clearSelection);
    }

    function clearSelection() {
        parentHidden.value = '';
        parentDisplay.style.display = 'none';
        parentSearch.style.display = '';
        parentSearch.value = '';
        parentSearch.focus();
    }

    // --- Status indicator ---
    function showStatus(msg, type) {
        submitStatus.textContent = msg;
        submitStatus.className = 'submit-status ' + type;
        submitStatus.style.display = 'block';
    }
    function hideStatus() {
        submitStatus.style.display = 'none';
    }

    // --- Modal open/close ---
    function openModal() {
        if (!currentTreeData) {
            try {
                currentTreeData = parseGoogleDocText(FALLBACK_DATA);
            } catch (e) {
                console.error('Could not load tree data for modal:', e);
            }
        }
        if (!currentTreeData) return;
        buildParentOptions();
        clearSelection();
        updateFieldVisibility();
        hideStatus();
        form.style.display = 'flex';
        resultBox.style.display = 'none';
        modal.style.display = 'flex';
    }

    function closeModal() {
        modal.style.display = 'none';
        form.reset();
        parentDropdown.style.display = 'none';
        clearSelection();
        hideStatus();
    }

    // --- Event listeners ---
    addBtn.addEventListener('click', openModal);
    if (overlay) overlay.addEventListener('click', closeModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (doneBtn) doneBtn.addEventListener('click', closeModal);

    addTypeSelect.addEventListener('change', () => {
        buildParentOptions();
        clearSelection();
        updateFieldVisibility();
    });

    parentSearch.addEventListener('focus', () => renderDropdown(parentSearch.value));
    parentSearch.addEventListener('input', () => renderDropdown(parentSearch.value));
    parentSearch.addEventListener('blur', () => {
        setTimeout(() => { parentDropdown.style.display = 'none'; }, 150);
    });

    // --- Form submission ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const addType = addTypeSelect.value;
        const allNodes = getAllNodes(currentTreeData);
        const selectedIdx = parentHidden.value;
        if (selectedIdx === '' || !allNodes[selectedIdx]) return;

        const targetNode = allNodes[selectedIdx];
        const firstName = document.getElementById('new-first-name').value.trim();
        const lastName = (addType === 'spouse') ? (document.getElementById('new-last-name').value.trim()) : '';
        const birthday = getBirthdayString();
        const hebrewBirthday = getHebrewBirthdayString();
        const email = (addType === 'spouse') ? (document.getElementById('new-email').value.trim()) : '';
        const address = (addType === 'spouse') ? (document.getElementById('new-address').value.trim()) : '';

        let gdocSnippet = '';
        let bdaySnippet = '';
        let contactSnippet = '';

        // Determine parent's last name from tree context.
        // The node.name is often just a first name (e.g. "Rachel Fraidel")
        // so we also check spouseName, fullText, and contacts/birthday data
        // to find the actual family surname.
        const knownSurnames = ['Tendler', 'Fried', 'Oren', 'Rappaport', 'Leibowitz', 'Kreiger',
            'Bohorodzaner', 'Charner', 'Rosner', 'Kaufman', 'Recht', 'Shoff', 'Shub',
            'Schiller', 'Goldman', 'Groll', 'Warn', 'Donaty', 'Bitter', 'Rosensweig',
            'Krumbein', 'Ben-Dovid', 'Ben-David', 'Shrem', 'Paley', 'Gefen', 'Geffen',
            'Ishon', 'Kazarnovsky', 'Jacobowitz', 'Nussbaum', 'Goldenberg', 'Davis',
            'Slasky', 'Fox', 'Schwartz', 'Feinstein', 'Hainovitz', 'Gnatek',
            'Reinstein', 'Katan', 'Goldberg', 'Perlow', 'Meirson', 'Shlomi', 'Kunin',
            'Tanenbaum', 'Roth', 'Dvir', 'Rothenberg', 'Bersin', 'Greenberg', 'Weiss',
            'Valt', 'Ovitz', 'Sebbag', 'Kahane', 'Jofen', 'Bender', 'Brickman',
            'Spetner', 'Gold', 'Berger', 'Lerner', 'Shapiro', 'Cohen', 'Eis',
            'Kreitenberg', 'Hechtman', 'Frenkel', 'Gruman', 'Hoffman', 'Pollak',
            'Schonkopf', 'Feldstein', 'Lieder', 'Donaty'];
        function extractFamilySurname(node) {
            // Check all text sources for a known surname
            const textSources = [
                node.spouseName || '',     // "Moshe Rosensweig"
                node.fullText || '',       // "Rachel Fraidel and Moshe Rosensweig"
                node.name || ''            // "Rachel Fraidel" (fallback)
            ];
            for (const text of textSources) {
                const words = text.trim().split(/\s+/);
                // Check from the end since surnames are typically last
                for (let i = words.length - 1; i >= 0; i--) {
                    const word = words[i].replace(/[()]/g, '');
                    if (knownSurnames.some(s => s.toLowerCase() === word.toLowerCase())) {
                        return word;
                    }
                }
            }
            // Also check contacts data for a matching contact
            const contact = findContactForNode(node);
            if (contact && contact.last) return contact.last;
            // Also check birthdays data
            for (const b of parsedBirthdays) {
                const nameToCheck = (node.name || '').split(' ')[0].toLowerCase();
                if (b.first && b.first.toLowerCase().includes(nameToCheck) && b.last) {
                    return b.last;
                }
            }
            // Last resort: last word of name
            return node.name.split(' ').slice(-1)[0] || 'Tendler';
        }
        const parentLastName = extractFamilySurname(targetNode);
        const finalLastName = lastName || parentLastName;

        if (addType === 'spouse') {
            targetNode.spouseName = firstName;
            if (lastName) {
                targetNode.maidenName = lastName;
            }
            gdocSnippet = `${targetNode.name} and ${firstName}${lastName ? ' (' + lastName + ')' : ''}`;
            bdaySnippet = `${finalLastName}\t${firstName}\t${birthday}\t${hebrewBirthday}`;
            if (email || address) {
                contactSnippet = `${finalLastName}\t${targetNode.name} & ${firstName}\tMr. & Mrs.\t${address}\t${email}`;
            }
        } else {
            if (!targetNode.children) targetNode.children = [];
            const newNode = {
                name: firstName,
                children: [],
                depth: (targetNode.depth || 1) + 1,
                number: targetNode.children.length + 1
            };
            targetNode.children.push(newNode);

            const indent = '   '.repeat(newNode.depth - 1);
            gdocSnippet = `${indent}* ${firstName}`;
            bdaySnippet = `${finalLastName}\t${firstName}\t${birthday}\t${hebrewBirthday}`;
        }

        if (birthday || hebrewBirthday) {
            parsedBirthdays.push({
                last: finalLastName,
                first: firstName,
                fullName: `${firstName} ${finalLastName}`.trim(),
                englishRaw: birthday,
                hebrewRaw: hebrewBirthday,
                englishParsed: parseEnglishBirthdayString(birthday),
                hebrewParsed: parseHebrewBirthdayString(hebrewBirthday)
            });
        }

        if (addType === 'spouse' && (email || address)) {
            parsedContacts.push({
                title: targetNode.name + (firstName ? ' & ' + firstName : ''),
                first: firstName,
                last: finalLastName,
                street: address,
                emails: email ? [email] : []
            });
        }

        // Re-render live tree with updated data
        renderTree(currentTreeData);

        // Display copyable results
        document.getElementById('result-gdoc-text').value = gdocSnippet;
        document.getElementById('result-birthday-text').value = bdaySnippet;
        
        const contactSec = document.getElementById('result-contact-section');
        if (contactSnippet) {
            document.getElementById('result-contact-text').value = contactSnippet;
            contactSec.style.display = 'block';
        } else {
            contactSec.style.display = 'none';
        }

        form.style.display = 'none';
        resultBox.style.display = 'flex';

        // --- POST to Google Apps Script backend ---
        if (typeof APPS_SCRIPT_URL !== 'undefined' && APPS_SCRIPT_URL) {
            showStatus('Saving to Google Docs & Sheets…', 'saving');
            try {
                const payload = {
                    type: addType,
                    parentName: targetNode.name,
                    parentSpouse: targetNode.spouseName || '',
                    firstName: firstName,
                    lastName: lastName,
                    familyName: finalLastName,
                    birthday: birthday,
                    hebrewBirthday: hebrewBirthday,
                    email: email,
                    address: address,
                    gdocSnippet: gdocSnippet
                };
                // Google Apps Script web apps redirect POST (302), which causes
                // browsers to convert POST→GET and lose the body. Using mode:
                // 'no-cors' lets the POST go through. The response is opaque so
                // we cannot read it, but the server-side write still happens.
                await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain' },
                    body: JSON.stringify(payload)
                });
                // With no-cors we can't inspect the response, so show success
                // after a short delay to let the server process.
                setTimeout(() => {
                    showStatus('✓ Saved to Google Doc & Sheets!', 'success');
                }, 1500);
            } catch (err) {
                console.error('Apps Script POST error:', err);
                showStatus('⚠ Saved locally. Could not reach Google backend — use the copy buttons above to update manually.', 'error');
            }
        }
    });

    ['gdoc', 'birthday', 'contact'].forEach(type => {
        const btn = document.getElementById(`copy-${type}-btn`);
        if (btn) {
            btn.addEventListener('click', () => {
                const textarea = document.getElementById(`result-${type}-text`);
                if (textarea) {
                    textarea.select();
                    navigator.clipboard.writeText(textarea.value);
                    const orig = btn.textContent;
                    btn.textContent = 'Copied!';
                    setTimeout(() => { btn.textContent = orig; }, 1500);
                }
            });
        }
    });
}

async function loadContacts() {
    let csvText = null;
    for (const proxyFn of CORS_PROXIES) {
        try {
            csvText = await fetchWithProxy(CONTACTS_EXPORT_URL, proxyFn);
            if (csvText && (csvText.includes('Email') || csvText.includes('Street') || csvText.includes('Tendler'))) {
                break;
            }
            csvText = null;
        } catch (e) {
            csvText = null;
        }
    }
    if (!csvText) {
        csvText = FALLBACK_CONTACTS_CSV;
    }
    parsedContacts = processContactsCSV(csvText);
}

// ============================================
// DATA LOADING
// ============================================

async function fetchWithProxy(url, proxyFn) {
    const proxyUrl = proxyFn(url);
    const response = await fetch(proxyUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
}

async function loadFamilyTree() {
    const loading = document.getElementById('loading');
    const errorEl = document.getElementById('error-message');
    const treeRoot = document.getElementById('tree-root');
    
    // Always default to B"H on page/tree load
    isCountRevealed = false;
    const totalStatEl = document.getElementById('stat-total-number');
    if (totalStatEl) totalStatEl.textContent = 'B"H';

    loading.style.display = 'flex';
    errorEl.style.display = 'none';
    treeRoot.innerHTML = '';
    
    // Load contacts spreadsheet and birthdays
    await loadContacts();
    await loadBirthdays();
    
    let rawText = null;
    let lastError = null;
    
    // Try each proxy in order
    for (const proxyFn of CORS_PROXIES) {
        try {
            rawText = await fetchWithProxy(EXPORT_URL, proxyFn);
            if (rawText && rawText.includes('Tendler')) {
                break; // Success
            }
            rawText = null;
        } catch (e) {
            lastError = e;
            rawText = null;
        }
    }
    
    loading.style.display = 'none';
    
    if (!rawText) {
        // Show error and fall back to embedded data
        console.warn('Could not fetch live data, using fallback. Last error:', lastError);
        try {
            rawText = FALLBACK_DATA;
            if (!rawText) throw new Error('No fallback data available');
        } catch (e) {
            errorEl.style.display = 'block';
            document.getElementById('error-text').textContent = 
                'Unable to load the family tree data. The Google Doc may not be publicly shared. Please ensure the document is set to "Anyone with the link can view".';
            return;
        }
    }
    
    try {
        const tree = parseGoogleDocText(rawText);
        currentTreeData = tree;
        renderTree(tree);
        
        // Update last refresh time
        const now = new Date();
        document.getElementById('last-refresh').textContent = 
            now.toLocaleDateString('en-US', { 
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            
        // Auto-expand top-level branches
        const topBranches = treeRoot.querySelectorAll('.branches > .branch-container > .branch-header');
        topBranches.forEach(header => {
            const content = header.nextElementSibling;
            header.classList.add('expanded');
            header.setAttribute('aria-expanded', 'true');
            if (content) content.classList.add('expanded');
        });

        // Load birthdays tab and show popup if birthdays found
        await loadBirthdays();
        renderBirthdayPopup(false);
        
    } catch (e) {
        console.error('Parse error:', e);
        errorEl.style.display = 'block';
        document.getElementById('error-text').textContent = 
            `Error parsing family tree data: ${e.message}`;
    }
}

// ============================================
// FALLBACK DATA (in case Google Doc can't be fetched due to CORS)
// ============================================

const FALLBACK_DATA = `Tendler Family Tree\r
Tendler Family Tree\r
\r
\r
Saba (Moshe David Tendler) and Savta (Shifra/Sifra Feinstein)\r
1. Rivky and Shabtai Rappaport\r
   1. Hodiya Ita and Yonatan Hainovitz\r
      * Hadarelle Dina Sima and Matanya Gnatek\r
      * Menachem Mendel Shaul Ariel\r
      * Hillel\r
      * Gavriel\r
      * Sara Tzion Shifra\r
   2. Miriam Chana and Tzvika Reinstein\r
      * Eliya and Bat El (Katan)\r
         1. Stav\r
         2. Dror Nachum\r
      * Shaul Ori and Roni (Goldberg)\r
      * Eitan Yaakov and Menuchah (Chaimov?)\r
      * Aviad\r
   3. Shmuel and Avigayil (Ki-Tov)\r
      * Ayala and Yehoshua Tunik\r
         1. Hodaya\r
         2. Moshe \r
         3. Malachi\r
      * Sima and Natan Perlow \r
         1. David\r
         2. Hallel\r
         3. Shlomo \r
      * Shaul\r
      * Chana\r
      * Eliyahu\r
      * Sara\r
      * Shifra\r
      * Yisroel Meir\r
      * Tehila\r
      * Orah\r
      * Ovadya Yosef\r
   4. Hadassah Elisheva and Shuki (Yehoshua) Meirson\r
      * Tal Or Bracha\r
      * Noga Oriya\r
      * Noam Matityahu\r
      * Sara Shifra\r
      * Aron Simcha\r
      * Milka Devora Sima \r
      * Adi Ahava\r
   5. Bella Atara and Michael Shlomi\r
      *  Malachy Yehuda\r
      * Yair\r
      * Asaf Chai\r
      * Shachar Mevaser\r
      * Ziv Moshe \r
   6. Ruti (Rut Tehila) and Noach Kunin\r
      * Michael Yaacov\r
      * Shifra Ahava\r
      * Yona Yitzchak\r
      * Chaya Carmel\r
   7. Yitzchak Issac and Eliana Rachel (Tanenbaum)\r
      * Naftali Ariel\r
      * Shifra Shira\r
      * Oriya Nechama\r
      * Shaul Amichai\r
      * Noam Shalom\r
      * Aryeh Lavi\r
      * Kaila Tzion \r
   8. Yisrael Shalom and Rivky (Roth)\r
      * Rimon Malka\r
      * Dvash\r
      * Mayim\r
      * Eretz Yonah\r
   9. Shauli\r
   10. Shimi (Shima Shalomtzion Simcha) and Uriya Dvir\r
      * Imri\r
      * Yarden Jenya\r
2. Yacov and Yael (Geffen)\r
   1. Aron and Tiffany (Rothenberg)\r
      * Maribel Miriam \r
   2. Fia and Avi Leibowitz\r
      * Shoshana Chaya and Ashi Bersin\r
         1. Chava Esther\r
         2. Hadassah Baila\r
         3. Golda Malka\r
         4. Moshe Dov\r
      * Ahuva and Yehuda Greenberg \r
         1. Leora Sima \r
      * Meir Simcha and Aleeza (Weiss)\r
         1. Kayla Devora \r
      * Shmuel\r
      * Tzipporah and Ezriel Valt\r
      * Yehoshua Benzion\r
   3. Avraham Shimon and Chanie (Ovitz)\r
      * Akiva\r
      * Shifra Hadas\r
      * Ester Rimon\r
      * Yitzchak Eliyahu\r
      * Talia Devora\r
   4. Bella and Dovid Kreiger\r
      * Jetta Pearl\r
      * Sienna Rose/ Sima Chana\r
      * Olivia Patrice/Luba Shifra\r
   5. Shlomo and Sarah (Sebbag)\r
      * Ayden Eliyahu\r
      * Ilan Chai\r
   6. Esther and Avi Bohorodzaner\r
      * Ava Shifra\r
      * Jamie/ Chaim Meir\r
      * Sima Liel\r
      * Yitzchak Moshe \r
   7. Tuvia and Kelila (Kahane)\r
      * Emil Sifra/ Amalia Shifra\r
      * Theodora Eve (Thea), Adira Chaya\r
3. Mordecai and Michelle (Jofen)\r
   1. Leah and Shlomo Charner\r
      * Sima and Moishy Slasky\r
         1. Dina\r
         2. Chana Devora \r
         3. Natan Tzvi\r
      * Chaya Miriam and Shlomo Zalman Fox \r
      * Yakov Chaim\r
      * Yocheved\r
      * Shifra\r
      * Tuvia\r
      * Esther Batsheva\r
   2. Rachel and Avi Rosner\r
      * Shlomo Menachem and Chani (Heimowitz)\r
      * Sarah Leah\r
      * Yosef Efraim\r
      * Yocheved\r
      * Yitzchak\r
      * Tzvi\r
      * Nechama\r
   3. Bella Shoshana and Moshe Kaufman\r
      * Simi and Yehuda Neuwirth\r
         1. Shifra \r
         2. Elka Bluma \r
      * Faigy\r
      * Yocheved\r
      * Shifra\r
      * Avrami (Avraham Chaim)\r
      * Yaakov\r
      * Ahron\r
      * Yisroel\r
   4. Rivka and Yehoshua Recht\r
      * Tzvi (Menashe Tzvi)\r
      * Shifra\r
      * Yosef Peretz\r
      * Liba  (Liba Ahuva)\r
      * Yocheved\r
      * (Fruma) Chana \r
   5. Sara and Elchanan Shoff\r
      * Shifra\r
      * Estee (Esther Faiga)\r
      * Yocheved\r
      * Yaakov Chaim\r
      * Fraida Golda (Goldi)\r
      * Chaya Leah\r
      * Moshe Dovid \r
   6. Tzipporah and Zev Shub\r
      * Shifra\r
      * Yeshaya Avraham\r
      * Yocheved\r
      * Chaim Ahron \r
      * Sima Basya\r
   7. Ariella and Meir Schiller\r
      * Yaakov Chaim\r
      * Aliza Leah\r
      * Shifra Bella\r
      * Rachel Chaya\r
      * Moshe Dovid\r
   8. Aharon Yosef and Shaindy (Lerner)\r
      * Dina \r
      * Devora Raizel\r
      * Moshe Dovid \r
4. Aron Boruch and Esther Tzipora (Shapiro)\r
   1. Naomi and Yirachmiel Goldman\r
      *  Sima Ariella and Moshe Dovid Cohen\r
         1. Sara malka\r
         2. Shoshana Bella  \r
      * Chaim Zev\r
      * Shifra Gittel\r
      * Shalom Eliyahu\r
      * Yisrael Yosef\r
   2. Yitzchak and Elisheva (Eis)\r
      * Chava Kayla and Elisha Kreitenberg\r
      * Ezra Chaim\r
      * Shifra Sara\r
      * Hadasa Morielle\r
      * Mordecai Hillel\r
   3. Dina and Avraham Groll\r
      * Chaim Tudres\r
      * Miriam Chaya\r
      * Shifra Leah\r
      * Atara Hadassa\r
      * Tehilla Menucha \r
   4. Shoshana and Yitz Warn\r
      * Chaim Zev\r
      * Sara Hadassah\r
      * Shifra Bella \r
   5. Elisheva and Dany Donaty\r
      * Meir Rachamim\r
      * Chaim Netanel\r
      * Moshe Dovid \r
      * Baby girl \r
5. Hillel and Mashie (Hechtman)\r
   1. Zevi and Sarah (Frenkel)\r
      * Shmuel Yitzy\r
      * Shifra\r
      * Tehila\r
      * Esther Batya (Esti)\r
      * Yosef Yehuda (Yossi)\r
   2. Sholom Chaim and Rivky (Gruman)\r
      * Yaakov\r
      * Miriam And Dovid Bender\r
      * Shifra\r
      * Rochel\r
      * Sara\r
      * Yitzchok Aryeh \r
      * Batsheva \r
   3. Aron Gershon and Naomi (Spetner)\r
      * Yehuda\r
      * Shifra\r
      * Tziporah\r
      * Yitzy\r
      * Yossi\r
      * Yehudis\r
      * Yechiel\r
      * Eliezer\r
      * Chana\r
      * Aryeh Mordechai\r
      * Moshe Dovid  \r
   4. Eli and Shulamis (Brickman)\r
      * Shifra\r
      * Simi\r
      * Gavriel\r
      * Baruch\r
      * Moshe Dovid \r
   5. Yitzi and Nechama (Lieder)\r
      * Yehudah\r
      * Shifrah\r
      * Raizel Miriam \r
      * Zev\r
      * Margalit Chana\r
   6. Rikki and Ephraim Davis\r
      * Shifra\r
      * Shmuel\r
      * Yitzchak Aryeh\r
      * Chava Sarah\r
      * Shoshana Rela \r
   7. Shlomo and Sarala (Gold)\r
      * Devorah\r
      * Shifra\r
      * Avraham (Abie)\r
      * Shalva\r
      * Sima \r
   8. Yacov and Rivka (Berger)\r
      * Binyamin Tzvi\r
      * Yitzchok Aryeh\r
      * Esther\r
   9. Simi and Michoel Nussbaum\r
      * Shifra Ahuva\r
      * Yitzchok Aryeh\r
      * Esther  \r
   10. Tamari and Moishie Goldenberg\r
      * Shifra \r
      * Aryeh Mayer \r
6. Sara and Avraham Oren\r
   1. Bella Renana and Yosef Krumbein\r
      * Noam Shimon\r
      * Tamar Shifra\r
      * Amitai Shlomo\r
      * Moshe Shalom\r
   2. Chana Golda and Tovia Ben-Dovid\r
      * Maayan Shifra\r
      * Yishai Michael\r
      * Yehudah Dov\r
      * Tal Batya\r
      * Moshe\r
      * Lavie Aharon  \r
   3. Chaim and Hagit (Zigler)\r
      * Hodaya\r
      * Ori Shifra\r
      * Hallel\r
      * Elad Moshe  \r
   4. Rachel and Elchanan Schwartz\r
      * Yuval Shifra\r
      * Shoham Tova\r
      * Tomer Baruch\r
   5. Yechiel Mordechai and Dafna (Ben Harush) Oren-Harush\r
      * Akiva Yitzchak \r
   6. Simma and Avraham Shrem\r
      * David Ori \r
   7. Yaakov Shalom and Leah Paley\r
   8. Tehilla Rivka and Sagi Gefen\r
      * Maor Ariel \r
   9. Leah Avital and Ariel Ishon \r
   10. Mass'et Shoshana\r
7. Russi and Sholom Fried\r
   1. Leah and Eitan Bitter\r
      * Bella Sophia (Baila Tzipporah)\r
      * Moriya Chaya (Maya)\r
   2. Yosef and Tamar (Feldstein)\r
      * Devora Rivka (Rivky)\r
      * Yitzchak Isaac (Yitzy)\r
      * Yaakov Koppel \r
      * Baila\r
   3. Yitzchak Isaac\r
   4. Sima \r
   5. Rachel Fraidel and Moshe Rosensweig\r
      * Miriam Shifra \r
      * Chayim Betzalel\r
8. Eli and Racheli (Schonkopf)\r
   1. Yossi and Yehudis (Pollak)\r
      * Malca\r
      * Yitzchak Isaac\r
      * Avraham Pinchos\r
      * Moshe Dovid\r
      * Avigdor \r
   2. Ari and Elky (Hoffman)\r
      * Kayla Hadassah\r
      * Blima Esther (Rosie)\r
      * Basya\r
   3. Sima and Zevi Kazarnovsky\r
      * Shifra\r
      * Chana\r
      * Moshe Dovid \r
   4. Leora and Yakov Jacobowitz\r
      * Moshe Dovid \r
      * Avraham \r
   5. Yitzy\r
`;

const FALLBACK_CONTACTS_CSV = `Last,First,Title,Street,City,State,Zip,Email,2nd Email
Ben-David,Chana Goldie & Tovia,Mr. &Mrs.,30/2 Rav Yisraeli ,Dolev,Israel,7193500,chanago8787@gmail.com,toviabd85@gmail.com
Bender,Dovid & Miriam,R' & Mrs.,39 Turin,Lakewood,NJ,8701,miriten67@gmail.com,
Bitter,Eitan and Leah,Dr. and Mrs. ,3-14 Alyson St,Fair Lawn,NJ,7410,Leahfried1@gmail.com,Eitanbitter@gmail.com
Bohorodzaner ,Avi and Ester,Mr and Mrs ,46 Auerbach lane ,Lawrence ,Ny,11559,ebohorod@gmail.com,
Davis,Ephraim & Rikki,Rabbi & Mrs.,6306 Pearce Ave.,Baltimore,MD,21215,rikkiho@gmail.com,
Goldenberg,Moishe & Tamari,Mr. & Mrs.,26 Sheraton Dr.,Lakewood,NJ,8701,tamaritendler@gmail.com,
Goldman,Yerachmiel & Naomi,Mr. & Mrs. ,6304 Lincoln Ave,Baltimore ,MD,21209,Jgoldman18@aol.com ,Naomimgoldman@gmail.com
Groll,Avraham & Dina,Mr. & Mrs.,195 Park Avenue,Passaic,NJ,0.07055,Avraham.groll@gmail.com,Dina.groll@gmail.com
Kaufman ,Moshe and Bella ,Rabbi and Mrs. ,6525 N Whipple St ,Chicago,IL ,60645,mandbkaufman@gmail.com ,
Kreiger,David & Bella,Dr. & Dr.,9264 Bay Drive,Surfside,FL,33154,tendlerbella@gmail.com,
Krumbein ,Bella Renana & Yosef,Mr & Mrs ,23/3 Beit Habchira,Efrat,Israel ,9045596,bellakrum@gmail.com,yokrum@gmail.com
Lebowitz,Avi and Fia ,Rabbi and Mrs. ,1641 Marina way,San Jose,CA,95125,Avilebo@gmail.com,Fialebo@gmail.com
Nusbaum,Michoel & Simi,Rabbi & Mrs. ,8036 Delmar,St. Louis,MO,63130,simitendler@gmail.com,
Oren,Avraham & Sara,Rabbi & Mrs,15 Halamed Hey,Efrat,Israel,9043835,aoren189@gmail.com,aoren1@bezeqint.net
Oren ,Yaakov and Leah,Mr. & Mrs.,"Hizkiyahu Hamelech 46, apartment 3 Jerusalem ",,Israel,9322406,yaakovoren@gmail.com,
Recht,Yehoshua and Rivka ,Rabbi and Mrs. ,6622 N Mozart St.,Chicago,IL ,60645,rivkarechtlpc@gmail.com ,
Rosensweig ,Moshe and Rachel ,Rabbi and Mrs,495 W. 187th St. APT 2D,New York,NY,10033,Rachelfried1@gmail.com,Rosensweigmoshe@gmail.com
Rosner,Avi and Rachel,Rabbi and Mrs. ,6 Harav Moshe Ben Tov ,Jersusalem,Israel,9776511,adrrosner@gmail.com ,
Schiller ,Meir and Ariella,Reb and Mrs.,20/47 Makhal,Jerusalem,IL ,977630,batarella@gmail.com,
Schwartz ,Rachel and Elchanan,Mr. & Mrs ,dov hoz 8 jerusalem ,jerusalem ,Israel ,9334167,racheloren21@gmail.com,elchanan07@gmail.com
Shlomi,Bella and Michael ,Mr. & Mrs ,POB 700,Ovnat,Israel,9065600,mikobel@gmail.com,
Shrem,Avraham and Simma,Mr. & Mrs.,"Halochem Hayehudi 36, Lod",,Israel ,,simma.oren@gmail.com,avraham.s.shrem@gmail.com 
Tendler,Zev & Sarah,Dr. & Mrs.,2308 Cheswolde Ave.,Baltimore,MD,21209,zevtendler@gmail.com,
Tendler,Sholom & Rivky,Rabbi & Mrs.,3303 Pinkney Rd.,Baltimore,MD,21215,stendler1@gmail.com,rivkyt@gmail.com
Tendler,Aron & Nami,Rabbi & Mrs.,2416 Taney Rd.,Baltimore,MD,21209,antendler@gmail.com,
Tendler,Eli & Shulamis,Rabbi & Mrs.,6 Mevo Timnah,Jerusalem,ISRAEL,,shulamisbrickman@yahoo.com,
Tendler,Yitzy & Nechama,Mr. & Mrs.,6603 Troy Ct.,Baltimore,MD,21209,tendleryitzy@gmail.com,
Tendler,Shlomo & Sarala,Mr. & Mrs.,2823 Baneberry Ct.,Baltimore,MD,21209,Shlomobaruch7@gmail.com,Saralatendler@gmail.com
Tendler,Yacov & Rivka,R' & Mrs.,514 Jarvis Rd.,Far Rockaway,NY,11691,rivkaberger98@gmail.com,
Tendler,Hillel & Mashie,Rabbi & Mrs. ,6709 Western Run Dr.,Baltimore,MD,21215,ht@nqgrg.com,
Tendler,Yossi and Yehudis,R and Mrs,48 arzie habira apt 28,jerusalem,Israel ,,yehudis214@gmail.com,
Tendler,Shlomo and Sarah,Dr and Mrs,1328 Biarritz Drive,Miami Beach,FL,33141,Tendlershlomo@gmail.com,
Tendler,Aron & Tiffany,Dr. & Dr.,255 Evernia St. Apt. 706,West Palm Beach,FL,33401,aron.tendler@gmail.com,tiffanyrothenberg@gmail.com
Tendler,Yacov and Yael,Dr. & Mrs.,36 Rivevot Efraim St.,"Kedumim, Israel 4485600",,,ytendlermd@gmail.com,
Tendler,Avraham Shimon,Dr. & Mrs.,10B Kol Tzofiach St.,"Kedumim, Israel 4485600",,,tendlerfamily@gmail.com,
Tendler,Tuvia & Kelila,Mr. & Mrs ,50 Riverside Drive #10G,New York,NY,10069,tuviat2@gmail.com,
Tendler ,Yitzchak & Elisheva ,Mr & Mrs ,402 South Pkwy,Clifton ,NJ,0.07014,isaactendler@gmail.com,eeis2004@yahoo.com
Tendler ,Mordecai and Michelle ,Rabbi and Mrs. ,653 Union Road ,New Hempstead ,NY ,10977,rtofnh@aol.com,
oren,Chaim and Hagit,Mr & Mrs,827 Shifon st.,"Haspin, Golan heights ",israel,1292000,chaim.oren@gmail.com,
Geffen,Tehilla Rivka and Sagi,Mr & Mrs,Asirey Zion st. ,Beer Sheva,Israel,,lally1.oren@gmail.com,
`;


const FALLBACK_BIRTHDAYS_CSV = "\"Last Name  Tendler Feinstein Rappaport Rappaport Hainovitz Hainovitz Gnatek Gnatek Hainovitz Hainovitz Hainovitz Hainovitz Reinstein Reinstein Reinstein Katan Reinstein Reinstein Reinstein Goldberg Reinstein Chaimov? Reinstein Rappaport Ki-Tov Tunik Tunik Tunik Tunik Tunik Perlow Perlow Perlow Perlow Perlow Rappaport Rappaport Rappaport Rappaport Rappaport Rappaport Rappaport Rappaport Rappaport Meirson Meirson Meirson Meirson Meirson Meirson Meirson Meirson Meirson Shlomi Shlomi Shlomi Shlomi Shlomi Shlomi Shlomi Kunin Kunin Kunin Kunin Kunin Kunin Rappaport Tanenbaum Rappaport Rappaport Rappaport Rappaport Rappaport Rappaport Rappaport Rappaport Roth Rappaport Rappaport Rappaport Rappaport Rappaport Dvir Dvir Dvir Dvir Tendler Geffen Tendler Rothenberg Tendler Leibowitz Leibowitz Bersin Bersin Bersin Bersin Bersin Bersin Greenberg Greenberg Greenberg Leibowitz Weiss Leibowitz Leibowitz Valt Valt Leibowitz Tendler Ovitz Tendler Tendler Tendler Tendler Tendler Kreiger Kreiger Kreiger Kreiger Kreiger Tendler Sebbag Tendler Tendler Bohorodzaner Bohorodzaner Bohorodzaner Bohorodzaner Bohorodzaner Bohorodzaner Tendler Kahane Tendler Tendler Tendler Jofen\",\"First Name  Moshe David Shifra/Sifra Rivky Shabtai Hodiya Ita Yonatan Hadarelle Dina Sima Matanya Menachem Mendel Shaul Ariel Hillel Gavriel Sara Tzion Shifra Miriam Chana Tzvika Eliya Bat El Stav Dror Nachum Shaul Ori Roni Eitan Yaakov Menuchah Aviad Shmuel Avigayil Ayala Yehoshua Hodaya Moshe Malachi Sima Natan David Hallel Shlomo Shaul Chana Eliyahu Sara Shifra Yisroel Meir Tehila Orah Ovadya Yosef Hadassah Elisheva Shuki (Yehoshua) Tal Or Bracha Noga Oriya Noam Matityahu Sara Shifra Aron Simcha Milka Devora Sima Adi Ahava Bella Atara Michael Malachy Yehuda Yair Asaf Chai Shachar Mevaser Ziv Moshe Ruti (Rut Tehila) Noach Michael Yaacov Shifra Ahava Yona Yitzchak Chaya Carmel Yitzchak Issac Eliana Rachel Naftali Ariel Shifra Shira Oriya Nechama Shaul Amichai Noam Shalom Aryeh Lavi Kaila Tzion Yisrael Shalom Rivky Rimon Malka Dvash Mayim Eretz Yonah Shauli Shimi (Shima Shalomtzion Simcha) Uriya Imri Yarden Jenya Yacov Yael Aron Tiffany Maribel Miriam Fia Avi Shoshana Chaya Ashi Chava Esther Hadassah Baila Golda Malka Moshe Dov Ahuva Yehuda Leora Sima Meir Simcha Aleeza Kayla Devora Shmuel Tzipporah Ezriel Yehoshua Benzion Avraham Shimon Chanie Akiva Shifra Hadas Ester Rimon Yitzchak Eliyahu Talia Devora Bella Dovid Jetta Pearl Sienna Rose/ Sima Chana Olivia Patrice/Luba Shifra Shlomo Sarah Ayden Eliyahu Ilan Chai Esther Avi Ava Shifra Jamie/ Chaim Meir Sima Liel Yitzchak Moshe Tuvia Kelila Emil Sifra/ Amalia Shifra Theodora Eve (Thea), Adira Chaya Mordecai Michelle\",\"Birthday Date (spell out month to avoid confusion) August 7th July 28th November 22nd April 14th August 30th October 8th August 1st May 3rd \",\"Jewish Birthday  כ״ז אב כו תמוז יד כסליו ט ניסן כ אלול ד חשוון כו תמוז ב אייר \",\"\",\"\",\"\",\"\"\n\"Charner\",\"Leah\",\"September 8\",\"כ\"\"ו אלול\",\"\",\"\",\"\",\"\"\n\"Charner\",\"Shlomo\",\"May 14\",\"כ\"\"ב אייר\",\"\",\"\",\"\",\"\"\n\"Slasky\",\"Sima\",\"June 9\",\"כ\"\"ה סיון\",\"\",\"\",\"\",\"\"\n\"Slasky\",\"Moishy\",\"\",\"י אב\",\"\",\"\",\"\",\"\"\n\"Slasky\",\"Dina\",\"\",\"ט\"\"ו תשרי\",\"\",\"\",\"\",\"\"\n\"Slasky\",\"Chana Devora\",\"\",\"ה אלול\",\"\",\"\",\"\",\"\"\n\"Slasky\",\"Tzvi (Nosson Tzvi) \",\"\",\"י טבת\",\"\",\"\",\"\",\"\"\n\"Fox\",\"Chaya Miriam\",\"June 15\",\"ט\"\"ו סיון\",\"\",\"\",\"\",\"\"\n\"Fox\",\"Shlomo Zalman\",\"\",\"כ\"\"ה טבת \",\"\",\"\",\"\",\"\"\n\"Charner\",\"Yakov Chaim\",\"June 15\",\"ט\"\"ו סיון\",\"\",\"\",\"\",\"\"\n\"Charner\",\"Yocheved\",\"December 27\",\"כ\"\"ז כסלו\",\"\",\"\",\"\",\"\"\n\"Charner\",\"Shifra\",\"March 22\",\"כ\"\"ו אדר\",\"\",\"\",\"\",\"\"\n\"Charner\",\"Tuvia\",\"July 24\",\"י\"\"ז אב\",\"\",\"\",\"\",\"\"\n\"Charner\",\"Esther Batsheva\",\"March 5\",\"ז אדר\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Rachel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Avi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Shlomo Menachem\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Heimowitz\",\"Chani\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Sarah Leah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Yosef Efraim\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Yocheved\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Yitzchak\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Tzvi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosner\",\"Nechama\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Bella Shoshana\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Moshe\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Neuwirth\",\"Simi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Neuwirth\",\"Yehuda\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Neuwirth\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Neuwirth\",\"Blumy\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Faigy\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Yocheved\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Avrami (Avraham Chaim)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Yaakov\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Ahron\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kaufman\",\"Yisroel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"Rivka\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"Yehoshua\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"Tzvi (Menashe Tzvi)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"Yosef Peretz\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"Liba  (Liba Ahuva)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"Yocheved\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Recht\",\"(Fruma) Chana\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Sara\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Elchanan\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Estee (Esther Faiga)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Yocheved\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Yaakov Chaim\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Fraida Golda (Goldi)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Chaya Leah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shoff\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shub\",\"Tzipporah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shub\",\"Zev\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shub\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shub\",\"Yeshaya Avraham\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shub\",\"Yocheved\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shub\",\"Chaim Ahron\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shub\",\"Sima Basya\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schiller\",\"Ariella\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schiller\",\"Meir\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schiller\",\"Yaakov Chaim\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schiller\",\"Aleeza Leah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schiller\",\"Shifra Bella\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schiller\",\"Rachel Chaya\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schiller\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Aharon Yosef\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Lerner\",\"Shaindy\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Dina\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Devora Raizel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Aron Boruch\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shapiro\",\"Esther Tzipora\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldman\",\"Naomi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldman\",\"Yirachmiel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Cohen\",\"Sima Ariella\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Cohen\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Cohen\",\"Sara malka\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Cohen\",\"Shoshana Bella\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldman\",\"Chaim Zev\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldman\",\"Shifra Gittel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldman\",\"Shalom Eliyahu\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldman\",\"Yisrael Yosef\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yitzchak\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Eis\",\"Elisheva\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kreitenberg\",\"Chava Kayla\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kreitenberg\",\"Elisha\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Ezra Chaim\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shifra Sara\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Hadasa Morielle\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Mordecai Hillel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Groll\",\"Dina\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Groll\",\"Avraham\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Groll\",\"Chaim Tudres\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Groll\",\"Miriam Chaya\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Groll\",\"Shifra Leah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Groll\",\"Atara Hadassa\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Groll\",\"Tehilla Menucha\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Warn\",\"Shoshana\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Warn\",\"Yitz\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Warn\",\"Chaim Zev\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Warn\",\"Sara Hadassah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Warn\",\"Shifra Bella\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Donaty\",\"Elisheva\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Donaty\",\"Dany\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Donaty\",\"Meir Rachamim\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Donaty\",\"Chaim Netanel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Donaty\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Donaty\",\"Baby girl\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Hillel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Hechtman\",\"Mashie\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Zevi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Frenkel\",\"Sarah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shmuel Yitzy\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Tehila\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Esther Batya (Esti)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yosef Yehuda (Yossi)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Sholom Chaim\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Gruman\",\"Rivky\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yaakov\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Bender\",\"Miriam\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Bender\",\"Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Rochel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Sara\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yitzchok Aryeh\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Batsheva\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Aron Gershon\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Spetner\",\"Naomi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yehuda\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Tziporah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yitzy\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yossi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yehudis\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yechiel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Eliezer\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Chana\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Aryeh Mordechai\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Eli\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Brickman\",\"Shulamis\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Simi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Gavriel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Baruch\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yitzi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Lieder\",\"Nechama\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yehudah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shifrah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Raizel Miriam\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Zev\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Margalit Chana\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Davis\",\"Rikki\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Davis\",\"Ephraim\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Davis\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Davis\",\"Shmuel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Davis\",\"Yitzchak Aryeh\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Davis\",\"Chava Sarah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Davis\",\"Shoshana Rela\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shlomo\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Gold\",\"Sarala\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Devorah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Avraham (Abie)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Shalva\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Sima\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yacov\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Berger\",\"Rivka\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Binyamin Tzvi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yitzchok Aryeh\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Esther\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Nussbaum\",\"Simi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Nussbaum\",\"Michoel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Nussbaum\",\"Shifra Ahuva\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Nussbaum\",\"Yitzchok Aryeh\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Nussbaum\",\"Esther\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldenberg\",\"Tamari\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldenberg\",\"Moishie\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldenberg\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Goldenberg\",\"Aryeh Mayer\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Sara\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Avraham\",\"July 8\",\"ב בתמוז\",\"\",\"\",\"\",\"\"\n\"Krumbein\",\"Bella Renana\",\"November 15\",\"ב' כסלו\",\"\",\"\",\"\",\"\"\n\"Krumbein\",\"Yosef\",\"February 23\",\"כ' אדר א'\",\"\",\"\",\"\",\"\"\n\"Krumbein\",\"Noam Shimon\",\"March 12\",\"א' ניסן\",\"\",\"\",\"\",\"\"\n\"Krumbein\",\"Tamar Shifra\",\"February 16\",\"ז' אדר א'\",\"\",\"\",\"\",\"\"\n\"Krumbein\",\"Amitai Shlomo\",\"September 14\",\"ה' תשרי\",\"\",\"\",\"\",\"\"\n\"Krumbein\",\"Moshe Shalom\",\"March 24\",\"י\"\"ד אדר ב' (פורים)\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Chana Golda\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Tovia\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Maayan Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Yishai Michael\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Yehudah Dov\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Tal Batya\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Moshe\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ben-Dovid\",\"Lavie Aharon\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Chaim\",\"June 23\",\"כ' סיוון\",\"\",\"\",\"\",\"\"\n\"Zigler\",\"Hagit\",\"October 10\",\"י''א תשרי\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Hodaya\",\"April 24\",\"י''ד אייר\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Ori Shifra\",\"March 10\",\"י''ט אדר\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Hallel\",\"March 12\",\"כ''ה אדר\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Elad Moshe\",\"December 5\",\"ד' כסלו\",\"\",\"\",\"\",\"\"\n\"Schwartz\",\"Rachel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schwartz\",\"Elchanan\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schwartz\",\"Yuval Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schwartz\",\"Shoham Tova\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schwartz\",\"Tomer Baruch\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren-Harush\",\"Yechiel Mordechai\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren-Harush\",\"Dafna (Ben Harush)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren-Harush\",\"Akiva Yitzchak\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Shrem\",\"Simma\",\"October 18\",\"כד תשרי\",\"\",\"\",\"\",\"\"\n\"Shrem\",\"Avraham\",\"May 22\",\"י\"\"ט אייר\",\"\",\"\",\"\",\"\"\n\"Shrem\",\"David Ori\",\"September 26\",\"ד תשרי\",\"\",\"\",\"\",\"\"\n\"Paley\",\"Yaakov Shalom\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Paley\",\"Leah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Gefen\",\"Tehilla Rivka\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Gefen\",\"Sagi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Gefen\",\"Maor Ariel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ishon\",\"Leah Avital\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Ishon\",\"Ariel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Mass'et Shoshana\",\"\",\"י\"\"א אדר א'\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Russi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Sholom\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Bitter\",\"Leah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Bitter\",\"Eitan\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Bitter\",\"Bella Sophia (Baila Tzipporah)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Bitter\",\"Moriya Chaya (Maya)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Yosef\",\"\",\"כ״ט כסלו\",\"\",\"\",\"\",\"\"\n\"Feldstein\",\"Tamar\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Devora Rivka (Rivky)\",\"\",\"כז חשון\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Yitzchak Isaac (Yitzy)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Yaakov Koppel\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Baila\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Yitzchak Isaac\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Fried\",\"Sima\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Rosensweig\",\"Rachel Fraidel\",\"March 2nd\",\"כ״ג אדר א\",\"\",\"\",\"\",\"\"\n\"Rosensweig\",\"Moshe\",\"July 9th\",\"כב' תמוז\",\"\",\"\",\"\",\"\"\n\"Rosensweig\",\"Miriam Shifra\",\"January 15th\",\"ה׳ שבט\",\"\",\"\",\"\",\"\"\n\"Rosensweig\",\"Chayim Betzalel\",\"September 2nd\",\"י״ח אלול\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Eli\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Schonkopf\",\"Racheli\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yossi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Pollak\",\"Yehudis\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Malca\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yitzchak Isaac\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Avraham Pinchos\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Avigdor\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Ari\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Hoffman\",\"Elky\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Kayla Hadassah\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Blima Esther (Rosie)\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Basya\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kazarnovsky\",\"Sima\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kazarnovsky\",\"Zevi\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kazarnovsky\",\"Shifra\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kazarnovsky\",\"Chana\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Kazarnovsky\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Jacobowitz\",\"Leora\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Jacobowitz\",\"Yakov\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Jacobowitz\",\"Moshe Dovid\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Jacobowitz\",\"Avraham\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Tendler\",\"Yitzy\",\"\",\"\",\"\",\"\",\"\",\"\"\n\"Oren\",\"Yaakov Shalom\",\"\",\"ו חשון \",\"\",\"\",\"\",\"\"\n\"Oren\",\"Leah\",\"\",\"כ\"\"ד ניסן\",\"\",\"\",\"\",\"\"";

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    setupControls();
    setupSearch();
    setupContactModal();
    setupPersonBirthdayModal();
    setupBHPrompt();
    setupBirthdayPopup();
    setupCalendarModal();
    setupAddMemberModal();
    loadFamilyTree();
});
