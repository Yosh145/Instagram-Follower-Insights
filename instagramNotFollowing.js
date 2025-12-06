/**
 * ====================================================================
 * instagram follower insights tool
 * ====================================================================
 * description:
 * a script that analyzes your instagram followers and following lists
 * to determine who is not following you back and who you are not following back
 *
 * inspired by: gist.github.com/abir-taheer/0d3f1313def5eec6b78399c0fb69e4b1
 *
 * usage:
 * 1. open https://www.instagram.com/ and log in
 * 2. open developer tools (f12 or right click -> inspect -> console)
 * 3. copy/paste this entire script into the console
 * 4. (optional) edit the config object below to set your target username
 * 5. press enter
 *
 * disclaimer:
 * this script uses external facing (technically internal) instagram apis. use responsibly
 * ====================================================================
 */

// !!!!!!!!!!!!!   TOOL DOES NOT STORE DATA - ONLY COMPARES FOLLOWING/FOLLOWERS   !!!!!!!!!!!!!

(function () {
    // ========================================================
    // configuration
    // ========================================================
    const CONFIG = {
        // target account to analyze (prompts if default)
        TARGET_USER: "YOUR_USERNAME_HERE",

        // users to fetch per api call (api limit ~200)
        PAGE_SIZE: 100,

        // request throttling (ms)
        SLEEP_MIN: 700,
        SLEEP_MAX: 1200,

        // wait time on 429 rate limit error (60000ms = 1 minute)
        COOL_DOWN_MS: 60000,

        // instagram web app id
        APP_ID: "936619743392459",
    };

    // ========================================================
    // utilities
    // ========================================================

    // async sleep helper
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    // generates random delay within config range
    const randomDelay = () => Math.floor(Math.random() * (CONFIG.SLEEP_MAX - CONFIG.SLEEP_MIN + 1)) + CONFIG.SLEEP_MIN;

    const style = {
        info: "color: #003366; font-weight: bold;",
        success: "color: #00c676; font-weight: bold;",
        error: "color: #ff3b30; font-weight: bold;",
        warn: "color: #ffcc00; font-weight: bold;",
        reset: "color: inherit;"
    };

    // console log wrapper
    const log = (msg, type = 'reset') => console.log(`%c[IG Helper] %c${msg}`, style.info, style[type]);

    // ========================================================
    // api client
    // ========================================================
    class InstagramAPI {
        constructor() {
            // attempt to retrieve the csrf token immediately upon instantiation
            this.csrfToken = this.getCsrfToken();
            if (!this.csrfToken) {
                console.warn("%c[Warning] Could not find CSRF Token. Requests might fail.", "color: orange");
            }
        }

        // retrieve csrf token via cookie or global object
        getCsrfToken() {
            try {
                const match = document.cookie.match(/csrftoken=([^;]+)/);
                if (match && match[1]) {
                    return match[1];
                }
            } catch (e) {
                // ignore
            }

            try {
                if (window._sharedData?.config?.csrf_token) {
                    return window._sharedData.config.csrf_token;
                }
            } catch (e) {
                // ignore
            }
            return "";
        }

        getHeaders() {
            return {
                "X-IG-App-ID": CONFIG.APP_ID,
                "X-CSRFToken": this.csrfToken,
                "X-Requested-With": "XMLHttpRequest",
                "X-ASBD-ID": "198387"
            };
        }

        // resolve username 
        async resolveUser(username) {
            log(`Resolving ID for user: ${username}...`);
            const url = `https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=${username}&include_reel=false`;

            try {
                const res = await fetch(url, {
                    headers: this.getHeaders()
                });

                if (!res.ok) {
                    throw new Error(`HTTP Error ${res.status}`);
                }

                const data = await res.json();
                const userEntry = data.users?.find(u => u.user.username.toLowerCase() === username.toLowerCase());

                if (!userEntry) {
                    throw new Error("User not found.");
                }

                return userEntry.user.pk;
            } catch (e) {
                console.error(e);
                throw new Error(`Failed to resolve username: ${username}`);
            }
        }

        // fetch complete user list
        async fetchPaginatedList(endpointType, userId) {
            let list = new Map();
            let nextMaxId = "";
            let hasNext = true;
            let pageCount = 0;

            log(`Starting fetch: ${endpointType}`, 'info');

            while (hasNext) {
                const url = `https://www.instagram.com/api/v1/friendships/${userId}/${endpointType}/?count=${CONFIG.PAGE_SIZE}${nextMaxId ? `&max_id=${nextMaxId}` : ''}`;

                try {
                    const res = await fetch(url, {
                        headers: this.getHeaders()
                    });

                    // rate limit handler: pause on 429, then retry
                    if (res.status === 429) {
                        log(`Rate limit hit. Cooling down for ${CONFIG.COOL_DOWN_MS / 1000}s...`, 'warn');
                        await sleep(CONFIG.COOL_DOWN_MS);
                        continue;
                    }

                    if (!res.ok) {
                        throw new Error(`HTTP Error ${res.status}`);
                    }

                    const data = await res.json();

                    // store minimal data to minimize memory usage
                    for (const u of data.users) {
                        list.set(u.pk, {
                            id: u.pk,
                            username: u.username,
                            fullName: u.full_name || "",
                            verified: u.is_verified,
                            link: `https://instagram.com/${u.username}`
                        });
                    }

                    pageCount++;
                    nextMaxId = data.next_max_id;
                    hasNext = !!nextMaxId;

                    console.log(`%c   -> Page ${pageCount}: Fetched ${data.users.length} users. Total Unique: ${list.size}`, "color: #888");

                    if (hasNext) {
                        await sleep(randomDelay());
                    }

                } catch (err) {
                    log(`Error fetching ${endpointType}: ${err.message}`, 'error');
                    break;
                }
            }
            log(`Finished ${endpointType}. Total: ${list.size}`, 'success');
            return list;
        }
    }

    // ========================================================
    // main logic
    // ========================================================
    window.IGHelper = {
        run: async function (username) {
            if (!username) {
                return;
            }

            if (window.location.hostname !== "www.instagram.com") {
                return alert("Run on instagram.com");
            }

            const api = new InstagramAPI();
            const start = performance.now();

            try {
                // step 1: resolve id
                const userId = await api.resolveUser(username);
                log(`User ID: ${userId}`, 'success');
                log("Fetching Followers and Following lists... (This may take time)", 'info');

                // step 2: concurrent fetch
                const [followersMap, followingMap] = await Promise.all([
                    api.fetchPaginatedList('followers', userId),
                    api.fetchPaginatedList('following', userId)
                ]);

                // step 3: analysis
                const notFollowingBack = [];
                const fans = [];

                // in following, not in followers
                followingMap.forEach((user, id) => {
                    if (!followersMap.has(id)) {
                        notFollowingBack.push(user);
                    }
                });

                // in followers, not in following
                followersMap.forEach((user, id) => {
                    if (!followingMap.has(id)) {
                        fans.push(user);
                    }
                });

                const duration = ((performance.now() - start) / 1000).toFixed(2);

                // step 4: output
                console.clear();
                log(`ANALYSIS COMPLETE in ${duration}s`, 'success');
                console.log(`%cTotal Followers: ${followersMap.size} | Total Following: ${followingMap.size}`, "font-size: 14px; font-weight: bold;");

                console.groupCollapsed(`%c THESE ACCOUNTS DO NOT FOLLOW YOU BACK: (${notFollowingBack.length})`, "color: #ff3b30; font-size: 12px;");
                console.table(notFollowingBack, ['username', 'fullName', 'verified']);
                console.groupEnd();

                console.groupCollapsed(`%c YOU DO NOT FOLLOW BACK THESE ACCOUNTS: (${fans.length})`, "color: #00c676; font-size: 12px;");
                console.table(fans, ['username', 'fullName', 'verified']);
                console.groupEnd();

                this.lastResult = {
                    username,
                    date: new Date().toISOString(),
                    notFollowingBack,
                    fans
                };
                // log(`Tip: Type 'IGHelper.download()' to save as JSON.`);

            } catch (e) {
                log(`Fatal Error: ${e.message}`, 'error');
            }
        },

        // idk if anyones gonna use this
        // download: function () {
        //     if (!this.lastResult) {
        //         return log("No results to download.", 'error');
        //     }
        //     const blob = new Blob([JSON.stringify(this.lastResult, null, 2)], {
        //         type: "application/json"
        //     });
        //     const a = document.createElement("a");
        //     a.href = URL.createObjectURL(blob);
        //     a.download = `ig_analysis_${this.lastResult.username}.json`;
        //     a.click();
        // }
    };

    // ========================================================
    // auto-run
    // ========================================================
    if (CONFIG.TARGET_USER && CONFIG.TARGET_USER !== "YOUR_USERNAME_HERE") {
        IGHelper.run(CONFIG.TARGET_USER);
    } else {
        const inputUser = prompt("IG Helper: Enter username to analyze:", "");
        if (inputUser) {
            IGHelper.run(inputUser);
        }
    }
})();