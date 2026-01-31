import './style.css';

const API_BASE_URL = '/api'; // Using relative URL to be proxied by Vite dev server and served from the same domain in production

interface Link {
    id: number;
    title: string;
    url: string;
    upvotes: number;
    downvotes: number;
    score: number;
    created_at: string;
}

let turnstileToken: string | null = null;

// --- Turnstile Rendering ---
function renderTurnstile() {
    const turnstileContainer = document.getElementById('turnstile-container');
    if (turnstileContainer && (window as any).turnstile) {
        (window as any).turnstile.render(turnstileContainer, {
            sitekey: '0x4AAAAAAARdAg_1a-B2z5g3', // Replace with your site key
            callback: function(token: string) {
                turnstileToken = token;
            },
        });
    }
}

// --- Link Rendering ---
function renderLinks(links: Link[]) {
    const linksContainer = document.getElementById('links-container');
    if (!linksContainer) return;

    linksContainer.innerHTML = ''; // Clear existing links

    const votedLinks = getVotedLinks();

    links.forEach(link => {
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';

        const canVote = !votedLinks.includes(link.id);

        linkItem.innerHTML = `
            <div class="voting">
                <button class="upvote" data-id="${link.id}" ${!canVote ? 'disabled' : ''}>▲</button>
                <span class="score">${link.score}</span>
                <button class="downvote" data-id="${link.id}" ${!canVote ? 'disabled' : ''}>▼</button>
            </div>
            <div class="link-details">
                <a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.title}</a>
                <div class="url">(${new URL(link.url).hostname})</div>
            </div>
        `;
        linksContainer.appendChild(linkItem);
    });

    addVotingEventListeners();
}

// --- API Interaction ---
async function fetchLinks() {
    try {
        const response = await fetch(`${API_BASE_URL}/links`);
        if (!response.ok) throw new Error('Failed to fetch links');
        const links: Link[] = await response.json();
        renderLinks(links);
    } catch (error) {
        console.error('Error fetching links:', error);
    }
}

async function submitLink(title: string, url: string) {
    if (!turnstileToken) {
        alert('Please complete the CAPTCHA');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/links`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, url, token: turnstileToken }),
        });

        if (response.ok) {
            alert('Link submitted for review!');
            (document.getElementById('submission-form') as HTMLFormElement).reset();
            (window as any).turnstile.reset();
            turnstileToken = null;
        } else {
            alert(`Submission failed: ${await response.text()}`);
        }
    } catch (error) {
        console.error('Error submitting link:', error);
        alert('An error occurred during submission.');
    }
}

async function vote(id: number, direction: 'upvote' | 'downvote') {
    if (!turnstileToken) {
        alert('Please complete the CAPTCHA to vote.');
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/links/${id}/${direction}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: turnstileToken }),
        });

        if (response.ok) {
            addVotedLink(id);
            fetchLinks(); // Refresh links to show new score
        } else {
            alert(`Vote failed: ${await response.text()}`);
        }
    } catch (error) {
        console.error(`Error ${direction}:`, error);
    }
}

// --- Local Storage for Voting ---
function getVotedLinks(): number[] {
    const voted = localStorage.getItem('votedLinks');
    return voted ? JSON.parse(voted) : [];
}

function addVotedLink(id: number) {
    const voted = getVotedLinks();
    voted.push(id);
    localStorage.setItem('votedLinks', JSON.stringify(voted));
}

// --- Event Listeners ---
function addSubmissionFormListener() {
    const form = document.getElementById('submission-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const titleInput = document.getElementById('title-input') as HTMLInputElement;
            const urlInput = document.getElementById('url-input') as HTMLInputElement;
            submitLink(titleInput.value, urlInput.value);
        });
    }
}

function addVotingEventListeners() {
    document.querySelectorAll('.upvote').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = (e.target as HTMLElement).dataset.id;
            if (id) vote(parseInt(id), 'upvote');
        });
    });

    document.querySelectorAll('.downvote').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = (e.target as HTMLElement).dataset.id;
            if (id) vote(parseInt(id), 'downvote');
        });
    });
}

// --- Initialization ---
function init() {
    renderTurnstile();
    fetchLinks();
    addSubmissionFormListener();
}

// Load Turnstile script and then initialize the app
const script = document.createElement('script');
script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback';
script.async = true;
script.defer = true;
(window as any).onloadTurnstileCallback = init;
document.head.appendChild(script);