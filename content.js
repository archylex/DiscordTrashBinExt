// UI

let button;

function getToolbar() {    
    const result = {};

    const toolbar = document.querySelector('[class^=toolbar]');
        
    if (toolbar) {
        result.toolbar = toolbar;

        const nodes = document.querySelectorAll('[class^=iconWrapper]');

        if (nodes && nodes.length > 2) {
            result.iconClass = nodes[1].classList[0];
            result.clickableClass = nodes[1].classList[1];
        } 

        const svg = nodes[1].querySelector('[class^=icon]');

        if (svg) result.svgClass = svg.className.baseVal;
    }

    return result;
}

function createTrashButton(args) {
    const trashButton = document.createElement('div');
      
    trashButton.id = 'trash-btn';    
    trashButton.setAttribute('role', 'button');
    trashButton.setAttribute('aria-label', 'Delete All Messages');
    trashButton.setAttribute('tabindex', '0');

    if (args.iconClass) setTrashButtonAttr(trashButton, args);
       
    return trashButton;
}

function setTrashButtonAttr(btn, attr) {
    let svgClass = attr.svgClass ? ` class="${attr.svgClass}"` : '';

    if (attr.iconClass) btn.classList.add(attr.iconClass);

    if (attr.clickableClass) btn.classList.add(attr.clickableClass);
    
    btn.innerHTML = `<svg x="0" y="0"${svgClass} aria-hidden="false" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M19 24h-14c-1.104 0-2-.896-2-2v-16h18v16c0 1.104-.896 2-2 2m3-19h-20v-2h6v-1.5c0-.827.673-1.5 1.5-1.5h5c.825 0 1.5.671 1.5 1.5v1.5h6v2zm-12-2h4v-1h-4v1z"></path></svg>`;

    btn.onclick = async () => {
        await removeAllMessages();
    }
}

function addTrashButton() {
    const toolbarParams = getToolbar();        

    if (toolbarParams.toolbar) {        
        button = createTrashButton(toolbarParams);        
        toolbarParams.toolbar.appendChild(button);
    }
}

function startButtonObserver() {
    const observer = new MutationObserver(function (_mutationsList, _observer) {
        if (!document.body.contains(button)) addTrashButton();
    });

    observer.observe(document.body, { attributes: false, childList: true, subtree: true });
}

startButtonObserver();

// Base

function getAuthInfo() {
    window.dispatchEvent(new Event('beforeunload'));
    window.localStorage = document.body.appendChild(document.createElement('iframe')).contentWindow.localStorage;
    return {
        token: JSON.parse(window.localStorage.token), 
        userId: JSON.parse(window.localStorage.user_id_cache)
    };
}

function getGuildAndChannelIds() {
    const ids = location.href.match(/channels\/([\w@]+)\/(\d+)/);
    return {
        guildId: ids[1],
        channelId: ids[2]
    };
}

function createSearcgQuery(auth, ids, offset = 0) {
    return `search?author_id=${auth.userId}&${ids.guildId !== '@me' ? ids.channelId + '&' : ''}sort_by=timestamp&sort_order=desc&offset=${offset}`;    
}

function getDeleteUrl(msg) {
    return `https://discord.com/api/v6/channels/${msg.channel_id}/messages/${msg.id}`;
}

async function removeAllMessages() {
    const searchDelay = 100;  
    const deleteDelay = 1000;     
    const authParams = getAuthInfo();
    const ids = getGuildAndChannelIds();
    const API_SEARCH_CHANNELID_URL = `https://discord.com/api/v6/channels/${ids.channelId}/messages/`;
    const API_SEARCH_GUILDID_URL = `https://discord.com/api/v6/guilds/${ids.guildId}/messages/`;    
    const headers = { 'Authorization': authParams.token };
    let url = ids.guildId === '@me' ? API_SEARCH_CHANNELID_URL : API_SEARCH_GUILDID_URL;
    let avgPing;
    let lastPing;
    let grandTotal;
    let throttledCount = 0;
    let throttledTotalTime = 0;
    let offset = 0;    

    console.log('Starting...');

    async function remove() {
        const wait = async ms => new Promise(done => setTimeout(done, ms));        
        const query = createSearcgQuery(authParams, ids, offset);
        let response;

        try {
            const responseTime = Date.now();            
            response = await fetch(url + query, { headers });
            lastPing = (Date.now() - responseTime);
            avgPing = avgPing > 0 ? (avgPing * 0.9) + (lastPing * 0.1) : lastPing;
        } catch (e) {
            return console.error(e);
        }

        // indexing 
        if (response.status === 202) {
            const waitingTime = (await response.json()).retry_after;
            throttledCount++;
            throttledTotalTime += waitingTime;
            await wait(waitingTime);
            return await remove();
        }
        
        if (!response.ok) {
            // API time limit
            if (response.status === 429) {
                const waitingTime = (await response.json()).retry_after;
                throttledCount++;
                throttledTotalTime += waitingTime;
                searchDelay += waitingTime;
                await wait(waitingTime * 2);
                return await remove();
            } else {
                return console.error(`Status: ${response.status}!\n`, await response.json());
            }
        }

        const data = await response.json();
        const total = data.total_results;

        if (!grandTotal) grandTotal = total;

        const discoveredMessages = data.messages.map(con => con.find(message => message.hit === true));
        const messagesToDelete = discoveredMessages.filter(msg => msg.type === 0 || msg.type === 6);
        const skippedMessages = discoveredMessages.filter(msg => !messagesToDelete.find(m => m.id === msg.id));
      
        if (messagesToDelete.length > 0) {
            for (let i = 0; i < messagesToDelete.length; i++) {
                const message = messagesToDelete[i];   
                let resp;

                try {
                    const startTime = Date.now();                    
                    resp = await fetch(getDeleteUrl(message), {
                        headers,
                        method: 'DELETE'
                    });
                    lastPing = (Date.now() - startTime);
                    avgPing = (avgPing * 0.9) + (lastPing * 0.1);
                } catch (e) {
                    console.error(e);
                }

                if (!resp.ok) {         
                    // API time limit           
                    if (resp.status === 429) {
                        const waitingTime = (await resp.json()).retry_after;
                        throttledCount++;
                        throttledTotalTime += waitingTime;
                        deleteDelay = waitingTime;
                        await wait(waitingTime * 2);
                        i--;
                    } else {
                        console.error(`Status: ${resp.status}`, await resp.json());
                    }
                }

                await wait(deleteDelay);
            }

            if (skippedMessages.length > 0) {
                grandTotal -= skippedMessages.length;
                offset += skippedMessages.length;                
            }
            
            await wait(searchDelay);
            
            return await remove();
        } else {
            return console.log('Finished!');
        }
    }

    return await remove();
}