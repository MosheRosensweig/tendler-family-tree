/**
 * Tendler Family Tree - Dynamic Google Doc Parser & Renderer
 * Fetches the family tree data from a published Google Doc and renders
 * an interactive, collapsible tree view.
 */

const DOC_ID = '18o4faR1TntMIWkh81W4yoLGZ5n9qOId1aXjxw8AcLQY';
const EXPORT_URL = `https://docs.google.com/document/d/${DOC_ID}/export?format=txt`;

const CONTACTS_SPREADSHEET_ID = '1YnDzBpLyBD4wiSHmMxAadLVCw5bPdAwGZY7qpaz3u0U';
const CONTACTS_EXPORT_URL = `https://docs.google.com/spreadsheets/d/${CONTACTS_SPREADSHEET_ID}/export?format=csv`;

let parsedContacts = [];

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
    
    const numberBadge = node.number != null 
        ? `<span class="branch-number">${node.number}</span>` 
        : '';
    
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
    const contactBadgeHtml = contact ? `<button class="contact-badge" title="View contact details"><span class="contact-badge-icon">📇</span> Contact</button>` : '';

    header.innerHTML = `${expandIcon}${numberBadge}${nameHtml}${countBadge}${contactBadgeHtml}`;
    
    // Attach listener to child-count B"H button
    const countBtn = header.querySelector('.child-count');
    if (countBtn) {
        countBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showBHModal();
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
    
    // Toggle expand/collapse when clicking header (unless clicking contact badge or count badge)
    header.addEventListener('click', (e) => {
        if (!e.target.closest('.contact-badge') && !e.target.closest('.child-count')) {
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
    const contactBadgeHtml = contact ? `<button class="contact-badge" title="View contact details"><span class="contact-badge-icon">📇</span> Contact</button>` : '';

    el.innerHTML = `<span class="leaf-dot"></span>${nameHtml}${contactBadgeHtml}`;

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
            if (!e.target.closest('.contact-badge')) {
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
    let debounceTimer;

    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = input.value.trim();
        clearBtn.classList.toggle('visible', query.length > 0);

        debounceTimer = setTimeout(() => {
            if (query.length === 0) {
                clearSearch();
                hideAutocomplete();
                resultsLabel.textContent = '';
                return;
            }
            performSearch(query);
        }, 150);
    });

    input.addEventListener('keydown', (e) => {
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

    if (!modal) return;

    const headerTitle = contact.title && contact.title.trim() 
        ? `${contact.title} ${contact.first} ${contact.last}` 
        : `${contact.first} ${contact.last}`;
        
    titleEl.textContent = headerTitle;
    subtitleEl.textContent = `Contact Info for ${nodeDisplayName || contact.last}`;

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

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
            hideBHModal();
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
    
    // Load contacts spreadsheet
    await loadContacts();
    
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

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    setupControls();
    setupSearch();
    setupContactModal();
    setupBHPrompt();
    loadFamilyTree();
});
