import './style.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://ranking-api.mparaz.workers.dev';
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA'; // Fallback to test key

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
let captchaSessionReady = false;

// --- Turnstile Rendering ---
function renderTurnstile() {
    const turnstileContainer = document.getElementById('turnstile-container');
    if (turnstileContainer && (window as any).turnstile) {
        (window as any).turnstile.render(turnstileContainer, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (token: string) => { turnstileToken = token; },
        });
    }
}

// --- Local Storage for Voting ---
type VoteStatus = 'up' | 'down';
type VotedLinks = Record<number, VoteStatus>;

function getVotedLinks(): VotedLinks {
    const voted = localStorage.getItem('votedLinks');
    return voted ? JSON.parse(voted) : {};
}

function updateVotedLink(id: number, status: VoteStatus | null) {
    const voted = getVotedLinks();
    if (status) {
        voted[id] = status;
    } else {
        delete voted[id];
    }
    localStorage.setItem('votedLinks', JSON.stringify(voted));
}


// --- Link Rendering ---
function renderLinks(links: Link[]) {
    const linksContainer = document.getElementById('links-container');
    if (!linksContainer) return;

    linksContainer.innerHTML = '';
    const votedLinks = getVotedLinks();

    links.forEach(link => {
        const linkItem = document.createElement('div');
        linkItem.className = 'link-item';
        const currentVote = votedLinks[link.id];

        linkItem.innerHTML = `
            <div class="voting">
                <button class="upvote" data-id="${link.id}">▲</button>
                <span class="score">${link.score}</span>
                <button class="downvote" data-id="${link.id}">▼</button>
            </div>
            <div class="link-details">
                <a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.title}</a>
                <div class="url">(${new URL(link.url).hostname})</div>
            </div>
        `;
        const upvoteButton = linkItem.querySelector('.upvote') as HTMLButtonElement;
        const downvoteButton = linkItem.querySelector('.downvote') as HTMLButtonElement;

        if (currentVote === 'up') {
            upvoteButton.classList.add('voted-up');
        } else if (currentVote === 'down') {
            downvoteButton.classList.add('voted-down');
        }

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
            // Don't reset the token on success, allow it to be reused
        } else {
            alert(`Submission failed: ${await response.text()}`);
            // If submission failed, the token might be bad, so reset the widget.
            (window as any).turnstile.reset();
            turnstileToken = null;
        }
    } catch (error) {
        console.error('Error submitting link:', error);
        alert('An error occurred during submission.');
        (window as any).turnstile.reset();
        turnstileToken = null;
    }
}

async function ensureCaptchaSession(): Promise<boolean> {
    if (captchaSessionReady) return true;
    if (!turnstileToken) {
        alert('Please complete the CAPTCHA to vote.');
        return false;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/captcha/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ token: turnstileToken }),
        });

        if (response.ok) {
            captchaSessionReady = true;
            (window as any).turnstile.reset();
            turnstileToken = null;
            return true;
        }

        alert('CAPTCHA verification failed. Please try again.');
        (window as any).turnstile.reset();
        turnstileToken = null;
        return false;
    } catch (error) {
        console.error('Error verifying CAPTCHA session:', error);
        (window as any).turnstile.reset();
        turnstileToken = null;
        return false;
    }
}

async function handleVote(id: number, clickedDirection: VoteStatus) {
    const hasSession = await ensureCaptchaSession();
    if (!hasSession) return;

    const votedLinks = getVotedLinks();
    const currentVote = votedLinks[id];
    let promise: Promise<any>;
    let nextVote: VoteStatus | null;

    if (currentVote === clickedDirection) { // User is clearing their vote
        promise = fetch(`${API_BASE_URL}/links/${id}/un${clickedDirection}vote`, {
            method: 'POST',
            credentials: 'include',
        });
        nextVote = null;
    } else if (currentVote) { // User is clicking the opposite button, which cancels the current vote
        promise = fetch(`${API_BASE_URL}/links/${id}/un${currentVote}vote`, {
            method: 'POST',
            credentials: 'include',
        });
        nextVote = null;
    } else { // User is casting a new vote
        promise = fetch(`${API_BASE_URL}/links/${id}/${clickedDirection}vote`, {
            method: 'POST',
            credentials: 'include',
        });
        nextVote = clickedDirection;
    }

    try {
        const response = await promise;
        if (response.ok) {
            // On success, update local state and re-fetch everything
            updateVotedLink(id, nextVote);
            fetchLinks();
        } else if (response.status === 403) {
            alert('Your CAPTCHA session expired. Please complete it again.');
            captchaSessionReady = false;
        } else {
            alert(`Vote failed. Please try again.`);
            captchaSessionReady = false;
        }
    } catch (error) {
        console.error(`Error voting:`, error);
        captchaSessionReady = false;
    }
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
            if (id) handleVote(parseInt(id), 'up');
        });
    });

    document.querySelectorAll('.downvote').forEach(button => {
        button.addEventListener('click', (e) => {
            const id = (e.target as HTMLElement).dataset.id;
            if (id) handleVote(parseInt(id), 'down');
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
