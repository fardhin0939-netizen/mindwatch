console.log("MINDWATCH SCRIPT LOADED");

// VISIBLE error reporter so failures are not silent
window.addEventListener("error", function (e) {
    var msg = (e && e.message) ? e.message : "Unknown error";
    var where = (e && e.filename) ? (e.filename.split("/").pop() + ":" + e.lineno) : "";
    var stack = "";
    if (e && e.error && e.error.stack) {
        stack = e.error.stack.split("\n").slice(0, 5).join(" <- ");
    }
    var banner = document.getElementById("jsErrorBanner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "jsErrorBanner";
        banner.style.cssText =
            "position:fixed;top:0;left:0;right:0;z-index:99999;" +
            "background:#c0392b;color:#fff;padding:10px 14px;" +
            "font:12px/1.4 monospace;box-shadow:0 2px 8px rgba(0,0,0,.3)";
        document.body.appendChild(banner);
    }
    banner.textContent = "JS ERROR: " + msg + "  @ " + where +
        (stack ? "  ||  " + stack : "");
    if (stack) console.error("STACK:", stack);
});

// Automatically attach the CSRF token to all mutating requests.
(function () {
    const originalFetch = window.fetch.bind(window);
    const csrfToken =
        document.querySelector('meta[name="csrf-token"]')
            ?.getAttribute("content") || "";

    window.fetch = function (url, options) {
        options = options || {};
        const method = (options.method || "GET").toUpperCase();

        if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
            options.headers = options.headers || {};
            const headers = options.headers;
            if (
                !headers["X-CSRFToken"] &&
                !headers["X-CSRF-TOKEN"]
            ) {
                headers["X-CSRFToken"] = csrfToken;
            }
        }

        return originalFetch(url, options);
    };
})();


// ======================================================
// STATE
// ======================================================

// ======================================================
// DARK / LIGHT THEME TOGGLE
// ======================================================
(function themeMode() {
    const btn = document.getElementById("themeToggle");

    function apply() {
        const dark =
            document.documentElement.getAttribute("data-theme") === "dark";
        const lbl = btn && btn.querySelector(".theme-toggle-label");
        const text = dark ? "☀️ Light mode" : "🌙 Dark mode";
        if (lbl) { lbl.textContent = text; }
        else if (btn) { btn.textContent = text; }
    }

    apply();

    if (btn) {
        btn.addEventListener("click", function () {
            const dark =
                document.documentElement.getAttribute("data-theme") === "dark";
            if (dark) {
                document.documentElement.removeAttribute("data-theme");
                try { localStorage.removeItem("mw-theme"); } catch (e) {}
            } else {
                document.documentElement.setAttribute("data-theme", "dark");
                try { localStorage.setItem("mw-theme", "dark"); } catch (e) {}
            }
            apply();
        });
    }
})();


const state = {
    score: null,
    sources: 0,
    last: null,
    monitoring: false,
    monitorStartedAt: null,
    interactionCount: 0,
    textChanges: 0
};
function showPage(pageId) {

    if (!pageId) return;

    const pages = document.querySelectorAll(".page");
    const navItems = document.querySelectorAll(".nav-item");

    // Hide all pages
    pages.forEach(function(page) {
        page.classList.remove("active-page");
    });

    // Show selected page
    const selectedPage = document.getElementById(pageId);

    if (!selectedPage) {
        console.error("Page not found:", pageId);
        return;
    }

    selectedPage.classList.add("active-page");

    // ⭐ UPDATE LEFT SIDEBAR HIGHLIGHT
    navItems.forEach(function(item) {
        item.classList.remove("active");
    });

    const selectedNav = document.querySelector(
        '.nav-item[data-page="' + pageId + '"]'
    );

    if (selectedNav) {
        selectedNav.classList.add("active");
    }

    if (pageId === "support") {
        renderDailyTips();
        loadMyProfessionalMessages();
        loadMyFeedback();
    }

    refreshSection(pageId);
}

// Re-populate a section's dynamic data whenever it becomes visible.
// This guarantees data is shown even after the logout modal is cancelled
// (which never changes the page but the user may perceive as "empty").
function refreshSection(pageId) {
    if (!pageId || refreshSection._busy) return;
    refreshSection._busy = true;
    try {
        if (pageId === "dashboard") {
            seedDashboard();
            if (typeof loadAssessmentHistory === "function") loadAssessmentHistory();
        } else if (pageId === "history") {
            if (typeof loadAssessmentHistory === "function") loadAssessmentHistory();
        } else if (pageId === "monitoring") {
            if (typeof renderMonitorHistory === "function") renderMonitorHistory();
        } else if (pageId === "reports") {
            if (typeof loadLatestAssessment === "function") loadLatestAssessment();
        }
    } finally {
        refreshSection._busy = false;
    }
}

// Seed dashboard, gauge and report from the server-rendered assessment so
// it works even if the client fetch fails. Extracted so it can be reused
// on every dashboard view.
function seedDashboard() {
    if (seedDashboard._busy) return;
    seedDashboard._busy = true;
    setTimeout(function () { seedDashboard._busy = false; }, 0);
    try {
        var seed = window.__latestAssessment;
        if (seed && seed.wellness_score !== undefined &&
            seed.wellness_score !== null) {
            var s = Number(seed.wellness_score);
            state.score = s;
            var bd = seed.risk_breakdown;
            if (typeof bd === "string") {
                try { bd = JSON.parse(bd); } catch (e) { bd = {}; }
            }
            if (!bd || typeof bd !== "object") bd = {};
            updateUI({
                score: s,
                risk: 100 - s,
                qPct: Number(bd.qPct) || 0,
                sleepRisk: Number(bd.sleepRisk) || 0,
                activityRisk: Number(bd.activityRisk) || 0,
                screenRisk: Number(bd.screenRisk) || 0,
                stressRisk: Number(bd.stressRisk) || 0,
                textRisk: Number(bd.textRisk) || 0,
                socialRisk: Number(bd.socialRisk) || 0,
                heartRateRisk: Number(bd.heartRateRisk) || 0,
                stepsRisk: Number(bd.stepsRisk) || 0,
                chatRisk: Number(bd.chatRisk) || 0,
                sources: bd.sources
            });
            var gv = document.getElementById("gaugeValue");
            if (gv) gv.textContent = Math.round(s);
            if (window.__updateRiskAlertUI) {
                window.__updateRiskAlertUI(100 - s);
            }
        }
    } catch (e) {
        console.error("seed-from-server error:", e);
    }
}

function getCurrentPage() {
    var el = document.querySelector(".page.active-page");
    return el ? el.id : null;
}

// Build state-aware daily wellness tips for the Care & Support page
function renderDailyTips() {

    var box = document.getElementById("dailyTips");
    if (!box) return;

    var hasScore = state.score !== null &&
                   state.score !== undefined &&
                   state.score !== "";
    var score = hasScore ? Number(state.score) : 0;
    var risk = 100 - score;

    var tips = [
        { icon: "😴", title: "Sleep",
          text: "Keep a regular sleep schedule and aim for enough rest each night." },
        { icon: "🧘", title: "Stress",
          text: "Take short breaks, practise slow breathing, and make time to relax." },
        { icon: "🚶", title: "Activity",
          text: "Add small amounts of movement throughout your day." }
    ];

    if (hasScore && risk >= 60) {
        tips = [
            { icon: "🧘", title: "Stress",
              text: "Your indicators suggest higher stress — try a 5-minute breathing break and consider talking to someone you trust." },
            { icon: "😴", title: "Sleep",
              text: "Protect your sleep: a consistent bedtime helps your mind recover." },
            { icon: "🤝", title: "Support",
              text: "Reaching out to a counsellor or professional is a strong, positive step." }
        ];
    } else if (risk >= 30) {
        tips = [
            { icon: "😴", title: "Sleep",
              text: "A steady sleep routine will help keep your wellness steady." },
            { icon: "🧘", title: "Stress",
              text: "Notice early stress signs and take mindful breaks before they build up." },
            { icon: "🚶", title: "Activity",
              text: "Gentle daily movement can lift your mood and energy." }
        ];
    }

    box.innerHTML = tips.map(function (t) {
        return "<div><h4>" + t.icon + " " + t.title +
            "</h4><p>" + t.text + "</p></div>";
    }).join("");

}

// Colour the Reports hero + risk badge from the wellness score
function applyReportRisk(score, riskLevel) {

    var hero = document.getElementById("reportHero");
    var badge = document.getElementById("reportRiskBadge");

    var s = Number(score);
    if (isNaN(s)) {
        if (hero) hero.className = "card report-main-card";
        if (badge) {
            badge.textContent = "--";
            badge.className = "risk-badge";
        }
        return;
    }

    var cls = "low";
    var label = riskLevel;
    if (!label || label === "Low") {
        cls = "low";
    } else if (label === "Moderate") {
        cls = "moderate";
    } else if (label === "High") {
        cls = "high";
    } else if (label === "Very High") {
        cls = "very-high";
    }

    if (hero) hero.className = "card report-main-card risk-" + cls;
    if (badge) {
        badge.textContent = (label || "Low") + " Risk";
        badge.className = "risk-badge risk-" + cls;
    }

}
// ======================================================
// MAIN INITIALIZATION
// ======================================================

document.addEventListener("DOMContentLoaded", function () {

    // Navigation
document.querySelectorAll(".nav-item").forEach(button => {

    button.addEventListener("click", async function () {

        const page =
            this.dataset.page;

        showPage(page);


        // Load latest data when Reports is opened
        if (page === "reports") {

            console.log(
                "REPORTS PAGE OPENED"
            );

            try {

                const response =
                    await fetch(
                        "/assessment-history",
                        {
                            cache: "no-store"
                        }
                    );

                const result =
                    await response.json();

                console.log(
                    "REPORT DATA:",
                    result
                );


                if (
                    !result.success ||
                    !result.assessments ||
                    result.assessments.length === 0
                ) {

                    console.log(
                        "No assessment found"
                    );

                    // Still fill the printable report with a
                    // friendly message so printing is never blank
                    const doc =
                        document.getElementById("reportDocument");
                    if (doc) {
                        const u =
                            document.querySelector(".profile b");
                        const du =
                            document.getElementById("reportDocUser");
                        const dd =
                            document.getElementById("reportDocDate");
                        const ds =
                            document.getElementById("reportDocScore");
                        const dr =
                            document.getElementById("reportDocRisk");
                        const db =
                            document.getElementById("reportDocBars");
                        const drec =
                            document.getElementById(
                                "reportDocRecommendation"
                            );
                        if (du) {
                            du.textContent =
                                "Prepared for: " +
                                (u ? u.textContent : "User");
                        }
                        if (dd) {
                            dd.textContent =
                                "Generated: " +
                                new Date().toLocaleString();
                        }
                        if (ds) ds.textContent = "— / 100";
                        if (dr) dr.textContent = "No assessment yet";
                        if (db) {
                            db.innerHTML =
                                "<p><b>No assessment recorded yet.</b>" +
                                "<br>Run a wellness screening to " +
                                "generate your personalised report.</p>";
                        }
                        if (drec) drec.textContent = "";
                    }
                    return;

                }


                const latest =
                    result.assessments[0];


                const score =
                    Number(
                        latest.wellness_score
                    );


                const risk =
                    latest.risk_level ||
                    (
                        score >= 70
                            ? "Low"
                            : score >= 40
                                ? "Moderate"
                                : "High"
                    );


                // ==========================
                // CURRENT INDICATOR
                // ==========================

                const currentIndicator =
                    document.getElementById(
                        "riskValue"
                    );

                const currentIndicatorText =
                    document.getElementById(
                        "riskText"
                    );


                if (currentIndicator) {

                    currentIndicator.textContent =
                        risk;

                }


                if (currentIndicatorText) {

                    currentIndicatorText.textContent =
                        "Educational screening indicator";

                }


                // ==========================
                // BREAKDOWN
                // ==========================

                const breakdown =
                    document.getElementById(
                        "reportBars"
                    );


                if (breakdown) {

                    const sleep =
                        Number(
                            latest.sleep_hours || 0
                        );

                    const activity =
                        Number(
                            latest.physical_activity || 0
                        );

                    const screen =
                        Number(
                            latest.screen_time || 0
                        );

                    const stress =
                        Number(
                            latest.stress_level || 0
                        );


                    const sleepRisk =
                        sleep < 5
                            ? 85
                            : sleep < 6
                                ? 65
                                : sleep < 7
                                    ? 40
                                    : 15;


                    const activityRisk =
                        activity < 20
                            ? 75
                            : activity < 40
                                ? 50
                                : activity < 60
                                    ? 30
                                    : 15;


                    const screenRisk =
                        screen > 10
                            ? 75
                            : screen > 8
                                ? 55
                                : screen > 6
                                    ? 35
                                    : 15;


                    const stressRisk =
                        Math.max(
                            0,
                            Math.min(
                                100,
                                (stress - 1) * 25
                            )
                        );


                    const items = [

                        [
                            "Sleep pattern",
                            sleepRisk
                        ],

                        [
                            "Activity pattern",
                            activityRisk
                        ],

                        [
                            "Screen-time pattern",
                            screenRisk
                        ],

                        [
                            "Stress input",
                            stressRisk
                        ],

                        [
                            "Overall risk",
                            100 - score
                        ]

                    ];


                    breakdown.innerHTML =
                        items.map(
                            item => `

                                <div class="bar-row">

                                    <div class="bar-label">

                                        <span>
                                            ${item[0]}
                                        </span>

                                        <b>
                                            ${Math.round(
                                                item[1]
                                            )}%
                                        </b>

                                    </div>

                                    <div class="bar-bg">

                                        <div
                                            class="bar-fill"
                                            style="
                                                width:${Math.min(
                                                    100,
                                                    item[1]
                                                )}%;
                                            ">
                                        </div>

                                    </div>

                                </div>

                            `
                        ).join("");

                }

            } catch (error) {

                console.error(
                    "Reports loading error:",
                    error
                );

            }
            // Also refresh the full latest-assessment report
            try {
                await loadLatestAssessment();
            } catch (error) {

                console.error(
                    "loadLatestAssessment error:",
                    error
                );

            }

        }

    });

    // Seed the report, gauge and monitoring score from the
    // server-rendered assessment so it works even if the client
    // fetch to /assessment-history fails (session/cookie issues)
    seedDashboard();

    // Also refresh from the API in the background
    loadLatestAssessment().catch(function (e) {
        console.error("initial loadLatestAssessment error:", e);
    });

});

    // Range outputs
    setupRanges();


    // Journal counter
    setupJournal();


    // AI SCREENING BUTTON
    const aiButton =
        document.getElementById("analyzeBtn");

    if (aiButton) {

        aiButton.addEventListener("click", async function () {

            console.log("RUN AI SCREENING CLICKED");

            aiButton.disabled = true;

            const originalText =
                aiButton.textContent;

            aiButton.textContent =
                "🧠 Running AI Screening...";

            try {

                await runAIScreening();

                aiButton.textContent =
                    "✓ AI Screening Complete";

                setTimeout(() => {
                    aiButton.textContent =
                        originalText;
                }, 2000);

            } catch (error) {

                console.error(
                    "AI SCREENING ERROR:",
                    error
                );

                alert(
                    "AI Screening Error:\n\n" +
                    error.message
                );

                aiButton.textContent =
                    originalText;
            }

            aiButton.disabled = false;

        });

    }


    // Print
    const printButton =
        document.getElementById("printBtn");

    if (printButton) {

        printButton.addEventListener(
            "click",
            () => window.print()
        );

    }


    // Reset
    const resetButton =
        document.getElementById("resetBtn");

    if (resetButton) {

        resetButton.addEventListener(
            "click",
            () => location.reload()
        );

    }


    // Consent
    setupConsent();


    // NLP
    setupNLP();


    // Charts
    makeCharts();


    // History
    loadAssessmentHistory();


    // Analytics
    loadAnalyticsData();

});


// ======================================================
// RANGE SETUP
// ======================================================

function setupRanges() {

    const ranges = {

        hr: [
            "hrOut",
            value => {
                updateHeartAdvice(Number(value));
                return value;
            }
        ],

        sleep: [
            "sleepOut",
            value => Number(value).toFixed(1)
        ],

        activity: ["activityOut", value => value],

        screen: ["screenOut", value => value],

        social: ["socialOut", value => value]

    };


    Object.entries(ranges).forEach(
        ([id, [outputId, formatter]]) => {

            const input =
                document.getElementById(id);

            if (!input) return;

            const output =
                document.getElementById(outputId);

            if (output) {
                output.textContent =
                    formatter(input.value);
            }

            input.addEventListener(
                "input",
                function () {

                    if (output) {

                        output.textContent =
                            formatter(input.value);

                    }

                }
            );

        }
    );
}


function updateHeartAdvice(bpm) {

    const el = document.getElementById("hrAdvice");
    if (!el) return;

    let level;
    let msg;

    if (!bpm || isNaN(bpm)) {
        level = "ok";
        msg = "Resting heart rate range for most adults: 60–100 BPM.";
    } else if (bpm < 60) {
        level = "low";
        msg = "Below 60 BPM on average — low resting heart rate. " +
              "This can be normal for athletes, but speak with a " +
              "professional if you feel dizzy, tired, faint or " +
              "short of breath.";
    } else if (bpm <= 100) {
        level = "ok";
        msg = "In the normal resting range (60–100 BPM). " +
              "Keep up good sleep, hydration and stress management.";
    } else {
        level = "high";
        msg = "Above 100 BPM at rest — try slow breathing, " +
              "hydration and rest. Consult a professional if " +
              "it stays high.";
    }

    el.setAttribute("data-level", level);
    el.textContent = msg;

}


// ======================================================
// JOURNAL
// ======================================================

function setupJournal() {

    const journal =
        document.getElementById("journal");

    if (!journal) return;

    journal.addEventListener(
        "input",
        function () {

            state.textChanges++;

            const text =
                journal.value.trim();

            const words =
                text
                    ? text.split(/\s+/).length
                    : 0;

            const counter =
                document.getElementById("wordCount");

            if (counter) {

                counter.textContent =
                    words + " words";

            }

        }
    );
}

// ======================================================
// RISK LEVEL
// ======================================================

function level(risk) {

    if (risk < 30) {
        return ["Low", "green"];
    }

    if (risk < 60) {
        return ["Moderate", "yellow"];
    }

    if (risk < 80) {
        return ["High", "orange"];
    }

    return ["Very High", "red"];
}

// ======================================================
// RUN AI SCREENING
// ======================================================

async function runAIScreening() {

    console.log("AI SCREENING STARTED");


    const journal =
        document.getElementById("journal");

    const hr =
        document.getElementById("hr");

    const sleep =
        document.getElementById("sleep");

    const activity =
        document.getElementById("activity");

    const screen =
        document.getElementById("screen");

    const social =
        document.getElementById("social");

    const stress =
        document.getElementById("stress");


    if (
        !journal ||
        !hr ||
        !sleep ||
        !activity ||
        !screen ||
        !social ||
        !stress
    ) {

        throw new Error(
            "Assessment fields are missing."
        );

    }


    const text =
        journal.value.trim();

    const heartRate =
        Number(hr.value);

    const sleepHours =
        Number(sleep.value);

    const physicalActivity =
        Number(activity.value);

    const screenTime =
        Number(screen.value);

    const socialInteractions =
        Number(social.value);

    const stressLevel =
        Number(stress.value);


    // Questionnaire
    let questionScore = 0;

    let questionMax = 0;


    document.querySelectorAll(".q").forEach(
        question => {

            const value =
                Number(question.value);

            const weight =
                Number(question.dataset.weight);

            questionScore +=
                value * weight;

            questionMax +=
                3 * weight;

        }
    );


    const questionRisk =
        questionMax > 0
            ? (questionScore / questionMax) * 100
            : 0;


    // Sleep
    const sleepRisk =
        sleepHours < 5
            ? 85
            : sleepHours < 6
                ? 65
                : sleepHours < 7
                    ? 40
                    : 15;


    // Activity
    const activityRisk =
        physicalActivity < 20
            ? 75
            : physicalActivity < 40
                ? 50
                : physicalActivity < 60
                    ? 30
                    : 15;


    // Screen
    const screenRisk =
        screenTime > 10
            ? 75
            : screenTime > 8
                ? 55
                : screenTime > 6
                    ? 35
                    : 15;


    // Stress
    const stressRisk =
        (stressLevel - 1) * 25;


    // Text
    let textRisk;

    if (
        window.nlpTextRisk !== undefined &&
        window.nlpTextRisk !== null
    ) {

        textRisk =
            Number(window.nlpTextRisk);

    } else {

        textRisk =
            text.length < 20
                ? 10
                : Math.min(
                    75,
                    15 +
                    text.split(/\s+/).length / 2
                );

    }

    // Chat-export (User-Shared Phone Data) analysis contributes its own risk
    const chatRisk = Number(window.nlpChatRisk) || 0;

    // Social interactions risk
    const socialRisk =
        socialInteractions < 2
            ? 60
            : socialInteractions < 4
                ? 40
                : 20;

    // Wearable: heart-rate risk (only if the user provided it)
    const heartRateRisk =
        heartRate > 0
            ? (heartRate > 100
                ? 70
                : heartRate > 90
                    ? 45
                    : 20)
            : 0;

    // Wearable: steps risk (only if the user synced step data)
    const steps =
        Number(window.__healthSteps) || 0;
    const stepsRisk =
        steps > 0
            ? (steps < 3000
                ? 65
                : steps < 6000
                    ? 45
                    : steps < 10000
                        ? 25
                        : 10)
            : 0;

    // ----- Adaptive weighted risk model -------------------------------
    // Core data is always available from the assessment.
    const haveWearable =
        heartRate > 0 || steps > 0;
    const haveBehaviour =
        chatRisk > 0;

    let totalWeight = 0;
    let weightedRisk = 0;
    const addRisk = function (weight, value) {
        totalWeight += weight;
        weightedRisk += weight * value;
    };

    addRisk(40, questionRisk);   // Questionnaire
    addRisk(12, sleepRisk);      // Sleep pattern
    addRisk(10, activityRisk);   // Physical activity
    addRisk(10, screenRisk);     // Screen time
    addRisk(16, stressRisk);     // Stress level
    addRisk(7, textRisk);        // Journal text
    addRisk(5, socialRisk);      // Social interactions

    // Wearable data is mixed in only when the user actually provided it
    if (haveWearable) {
        if (heartRate > 0) addRisk(6, heartRateRisk);
        if (steps > 0) addRisk(4, stepsRisk);
    }

    // Behavioural (phone chat export) data is mixed in only when provided
    if (haveBehaviour) {
        addRisk(8, chatRisk);
    }

    const risk = Math.round(
        totalWeight > 0 ? weightedRisk / totalWeight : 0
    );

    const usedSources = [];
    usedSources.push("Questionnaire");
    usedSources.push("Sleep", "Activity", "Screen time", "Stress");
    usedSources.push("Journal text");
    usedSources.push("Social interactions");
    if (heartRate > 0) usedSources.push("Wearable heart rate");
    if (steps > 0) usedSources.push("Wearable steps");
    if (haveBehaviour) usedSources.push("Chat-export sentiment");


// Wellness
const score =
    Math.max(
        0,
        Math.min(
            100,
            Math.round(100 - risk)
        )
    );


    state.score = score;

    state.last = new Date();
window.wellnessScore = score;
    state.sources =
        (text.length > 10 ? 1 : 0) + 2;


    console.log(
        "Wellness Score:",
        score
    );


    // Update UI
    updateUI({
        score: score,
        risk: risk,
        qPct: questionRisk,
        sleepRisk: sleepRisk,
        activityRisk: activityRisk,
        screenRisk: screenRisk,
        stressRisk: stressRisk,
        textRisk: textRisk,
        socialRisk: socialRisk,
        heartRateRisk: heartRateRisk,
        stepsRisk: stepsRisk,
        chatRisk: chatRisk,
        sources: usedSources
    });


    // Save MySQL
    await saveAssessmentToDatabase({

        journal_text: text,

        heart_rate: heartRate,

        sleep_hours: sleepHours,

        physical_activity:
            physicalActivity,

        screen_time:
            screenTime,

        social_interactions:
            socialInteractions,

        stress_level:
            stressLevel,

        wellness_score:
            score,

        risk_level:
            level(risk)[0],

        risk_breakdown: {
            qPct: questionRisk,
            sleepRisk: sleepRisk,
            activityRisk: activityRisk,
            screenRisk: screenRisk,
            stressRisk: stressRisk,
            textRisk: textRisk,
            socialRisk: socialRisk,
            heartRateRisk: heartRateRisk,
            stepsRisk: stepsRisk,
            chatRisk: chatRisk,
            sources: usedSources
        }

    });


    // Refresh history
    await loadAssessmentHistory();


    // Refresh chart
    await loadAnalyticsData();


    console.log(
        "AI SCREENING FINISHED"
    );

}


// ======================================================
// UPDATE UI
// ======================================================

function updateUI(data) {

    if (updateUI._busy) return;
    updateUI._busy = true;
    setTimeout(function () { updateUI._busy = false; }, 0);

    const riskResult = level(data.risk);
    const riskLevel = Array.isArray(riskResult)
        ? riskResult[0]
        : riskResult;

    // Keep Risk Alerts page in sync with the latest result
    if (window.__updateRiskAlertUI) {
        window.__updateRiskAlertUI(Number(data.risk) || 0);
    }

    // ==============================
    // WELLNESS OVERVIEW
    // ==============================

    const wellnessScore =
        document.getElementById("wellnessScore");

    const wellnessStatus =
        document.getElementById("wellnessStatus");

    const wellnessMessage =
        document.getElementById("wellnessMessage");

    const sleepScore =
        document.getElementById("sleepScore");

    const stressScore =
        document.getElementById("stressScore");

    const activityScore =
        document.getElementById("activityScore");

    const screenScore =
        document.getElementById("screenScore");

    const heartScore =
        document.getElementById("heartScore");

    const wellnessInsight =
        document.getElementById("wellnessInsight");


    // Score
    const score =
        Number(data.score) || 0;
        // ==============================
// WELLNESS TREND
// ==============================

const currentTrendScore =
    document.getElementById("currentTrendScore");

const previousTrendScore =
    document.getElementById("previousTrendScore");

const trendChange =
    document.getElementById("trendChange");

const assessmentCount =
    document.getElementById("assessmentCount");

const trendMessage =
    document.getElementById("trendMessage");

const trendPill =
    document.getElementById("trendPill");


let previousScore =
    Number(localStorage.getItem("previousWellnessScore"));

let count =
    Number(localStorage.getItem("assessmentCount")) || 0;


// Increase assessment count
count++;


// Display current score
if (currentTrendScore) {

    currentTrendScore.textContent =
        Math.round(score);

}


// Display previous score
if (
    previousTrendScore &&
    !isNaN(previousScore)
) {

    previousTrendScore.textContent =
        Math.round(previousScore);

} else if (previousTrendScore) {

    previousTrendScore.textContent =
        "--";

}


// Calculate change
if (
    trendChange &&
    !isNaN(previousScore)
) {

    const difference =
        Math.round(score - previousScore);

    if (difference > 0) {

        trendChange.textContent =
            "+" + difference;

    } else {

        trendChange.textContent =
            difference;

    }

} else if (trendChange) {

    trendChange.textContent =
        "--";

}


// Assessment count
if (assessmentCount) {

    assessmentCount.textContent =
        count;

}


// Trend message
if (
    trendMessage &&
    !isNaN(previousScore)
) {

    const difference =
        Math.round(score - previousScore);


    if (difference > 0) {

        trendMessage.textContent =
            `Your wellness score improved by ${difference} points compared with your previous assessment.`;

    }

    else if (difference < 0) {

        trendMessage.textContent =
            `Your wellness score changed by ${Math.abs(difference)} points compared with your previous assessment.`;

    }

    else {

        trendMessage.textContent =
            "Your wellness score is stable compared with your previous assessment.";

    }

}


// Trend pill
if (
    trendPill &&
    !isNaN(previousScore)
) {

    const difference =
        score - previousScore;


    if (difference > 0) {

        trendPill.textContent =
            "Improving";

    }

    else if (difference < 0) {

        trendPill.textContent =
            "Needs Attention";

    }

    else {

        trendPill.textContent =
            "Stable";

    }

}


// Save current score for next assessment
localStorage.setItem(
    "previousWellnessScore",
    score
);

localStorage.setItem(
    "assessmentCount",
    count
);

    if (wellnessScore) {
        wellnessScore.textContent =
            Math.round(score);
    }


    // Status
    if (wellnessStatus) {

        wellnessStatus.textContent =
            riskLevel || "Ready for Assessment";

    }


    // Message
    if (wellnessMessage) {

        if (score >= 70) {

            wellnessMessage.textContent =
                "Your current wellness indicators look generally positive.";

        } else if (score >= 40) {

            wellnessMessage.textContent =
                "Some wellness indicators may benefit from attention.";

        } else {

            wellnessMessage.textContent =
                "Several wellness indicators may need attention.";

        }

    }


    // Individual indicators
    if (sleepScore) {

        sleepScore.textContent =
            Math.round(Number(data.sleepRisk) || 0) + "%";

    }


    if (stressScore) {

        stressScore.textContent =
            Math.round(Number(data.stressRisk) || 0) + "%";

    }


    if (activityScore) {

        activityScore.textContent =
            Math.round(Number(data.activityRisk) || 0) + "%";

    }


    if (screenScore) {

        screenScore.textContent =
            Math.round(Number(data.screenRisk) || 0) + "%";

    }


    if (heartScore) {

        heartScore.textContent =
            Math.round(Number(data.heartRateRisk) || 0) + "%";

    }


    // Insight
    if (wellnessInsight) {

        if (score >= 70) {

            wellnessInsight.textContent =
                "Your overall wellness indicators are looking positive. Continue maintaining healthy daily routines.";

        } else if (score >= 40) {

            wellnessInsight.textContent =
                "Some areas may need attention. Reviewing sleep, stress, activity and screen-time habits may help.";

        } else {

            wellnessInsight.textContent =
                "Several indicators suggest that additional attention to your daily wellness habits may be helpful.";

        }

    }


    const riskValue =
        document.getElementById(
            "riskValue"
        );

    const riskText =
        document.getElementById(
            "riskText"
        );

    const wellnessValue =
        document.getElementById(
            "wellnessValue"
        );

    const sourceValue =
        document.getElementById(
            "sourceValue"
        );

    const lastCheck =
        document.getElementById(
            "lastCheck"
        );


    if (riskValue) {
        riskValue.textContent =
            riskLevel;
    }


    if (riskText) {
        riskText.textContent =
            "Educational screening indicator";
    }


  if (wellnessValue) {
    wellnessValue.textContent =
        data.score !== undefined && data.score !== null
            ? Math.round(data.score)
            : "--";
}

    if (sourceValue) {
        sourceValue.textContent =
            state.sources + "/3";
    }


    if (lastCheck) {

    lastCheck.textContent =
        state.last
            ? state.last.toLocaleTimeString(
                [],
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            )
            : "--";

}


    // Gauge
    const gaugeValue =
        document.getElementById(
            "gaugeValue"
        );

    const gaugeLabel =
        document.getElementById(
            "gaugeLabel"
        );

    if (gaugeValue) {
        gaugeValue.textContent =
            data.score;
    }

    if (gaugeLabel) {
        gaugeLabel.textContent =
            riskLevel +
            " indicator — not a diagnosis";
    }

    // Reports-section gauge (separate id to avoid clash)
    const reportGauge =
        document.getElementById("reportGaugeValue");
    if (reportGauge) {
        reportGauge.textContent = data.score;
    }
    const reportGaugeEl =
        document.querySelector(".gauge-container .gauge");
    if (reportGaugeEl) {
        const deg = data.score * 3.6;
        reportGaugeEl.style.background =
            `conic-gradient(#2e79d0 ${deg}deg, var(--gauge-track) ${deg}deg)`;
    }


    const gauge =
        document.querySelector(".gauge");

    if (gauge) {

        const degrees =
            data.score * 3.6;

        gauge.style.background =
            `conic-gradient(
                #2e79d0 ${degrees}deg,
                var(--gauge-track) ${degrees}deg
            )`;
    }


    // Breakdown
    const bars =
        document.getElementById("bars");

    if (bars) {
const items = [
    [
        "Self-reported indicators",
        Number(data.qPct) || 0
    ],

    [
        "Sleep pattern",
        Number(data.sleepRisk) || 0
    ],

    [
        "Activity pattern",
        Number(data.activityRisk) || 0
    ],

    [
        "Screen-time pattern",
        Number(data.screenRisk) || 0
    ],

    [
        "Stress input",
        Number(data.stressRisk) || 0
    ],

    [
        "Text signal",
        Number(data.textRisk) || 0
    ]];

    if (Number(data.socialRisk) > 0) {
        items.push(["Social pattern", Number(data.socialRisk) || 0]);
    }
    if (Number(data.heartRateRisk) > 0) {
        items.push(["Heart rate (wearable)", Number(data.heartRateRisk) || 0]);
    }
    if (Number(data.stepsRisk) > 0) {
        items.push(["Steps (wearable)", Number(data.stepsRisk) || 0]);
    }
    if (Number(data.chatRisk) > 0) {
        items.push(["Chat-export sentiment", Number(data.chatRisk) || 0]);
    }

        bars.innerHTML =
            items.map(
                item => `

                    <div class="bar-row">

                        <div class="bar-label">

                            <span>
                                ${item[0]}
                            </span>

                            <b>
                                ${Math.round(item[1])}%
                            </b>

                        </div>

                        <div class="bar-bg">

                            <div
                                class="bar-fill"
                                style="
                                    width:${Math.min(
                                        100,
                                        item[1]
                                    )}%;
                                ">
                            </div>

                        </div>

                    </div>

                `
            ).join("");

        const reportBarsEl =
            document.getElementById("reportBars");
        if (reportBarsEl) {
            reportBarsEl.innerHTML = bars.innerHTML;
        }

    }


    // Report
    const reportPill =
        document.getElementById(
            "reportPill"
        );

    const reportTitle =
        document.getElementById(
            "reportTitle"
        );

    const reportScore =
        document.getElementById(
            "reportScore"
        );

    const reportSummary =
        document.getElementById(
            "reportSummary"
        );

    const recommendation =
        document.getElementById(
            "recommendation"
        );


    if (reportPill) {
        reportPill.textContent =
            riskLevel + " Indicator";
    }


    if (reportTitle) {
        reportTitle.textContent =
            riskLevel +
            " wellness-risk indicator";
    }


    if (reportScore) {
        reportScore.textContent =
            data.score;
    }

    applyReportRisk(data.score, riskLevel);


    if (reportSummary) {

        reportSummary.textContent =
            `The demo pipeline produced a wellness score of ${data.score}/100 from the selected inputs.`;

    }


    if (recommendation) {

        recommendation.textContent =

            riskLevel === "Low"

                ? "Continue healthy routines and monitor changes over time."

                : riskLevel === "Moderate"

                    ? "Consider reviewing sleep, stress and daily routines; if concerns persist, speak with a professional."

                    : "Consider discussing persistent concerns with a qualified mental-health professional. This result is not a diagnosis.";

    }


    updateCharts(data.score);

    // ==============================
    // PRINTABLE REPORT DOCUMENT
    // ==============================
    const doc = document.getElementById("reportDocument");

    if (doc) {
        const docUser =
            document.getElementById("reportDocUser");
        const docDate =
            document.getElementById("reportDocDate");
        const docScore =
            document.getElementById("reportDocScore");
        const docRisk =
            document.getElementById("reportDocRisk");
        const docBars =
            document.getElementById("reportDocBars");
        const docRec =
            document.getElementById("reportDocRecommendation");

        if (docUser) {
            if (!state.userName) {
                const pb =
                    document.querySelector(".profile b");
                state.userName =
                    pb ? pb.textContent : "User";
            }
            docUser.textContent =
                "Prepared for: " + (state.userName || "User");
        }
        if (docDate) {
            docDate.textContent =
                "Generated: " + new Date().toLocaleString();
        }
        if (docScore) {
            docScore.textContent = Math.round(score) + " / 100";
        }
        if (docRisk) {
            docRisk.textContent = riskLevel;
        }
        if (docBars) {
            const rows = [
                ["Self-reported indicators", data.qPct],
                ["Sleep pattern", data.sleepRisk],
                ["Activity pattern", data.activityRisk],
                ["Screen-time pattern", data.screenRisk],
                ["Stress input", data.stressRisk],
                ["Text signal", data.textRisk]
            ];
            if (Number(data.socialRisk) > 0) {
                rows.push(["Social pattern", data.socialRisk]);
            }
            if (Number(data.heartRateRisk) > 0) {
                rows.push(["Heart rate (wearable)", data.heartRateRisk]);
            }
            if (Number(data.stepsRisk) > 0) {
                rows.push(["Steps (wearable)", data.stepsRisk]);
            }
            if (Number(data.chatRisk) > 0) {
                rows.push(["Chat-export sentiment", data.chatRisk]);
            }
            docBars.innerHTML = rows.map(function (r) {
                const v = Math.round(Number(r[1]) || 0);
                return "<div class='rbar'>" +
                    "<span>" + r[0] + "</span>" +
                    "<div class='rbar-bg'><div class='rbar-fill' " +
                    "style='width:" + Math.min(100, v) + "%'></div></div>" +
                    "<b>" + v + "%</b></div>";
            }).join("");
        }
        if (docRec && recommendation) {
            docRec.textContent = recommendation.textContent;
        }
    }
 // ======================================================
// DYNAMIC AI CONFIDENCE
// ======================================================

const confidenceValue =
    document.getElementById("confidenceValue");

const confidenceText =
    document.getElementById("confidenceText");

if (confidenceValue) {

    let confidence = 50;

    let availableSignals = 0;
    let totalSignals = 5;


    // 1. Questionnaire
    const questions =
        document.querySelectorAll(".q");

    if (questions.length > 0) {

        let answeredQuestions = 0;

        questions.forEach(question => {

            if (
                question.value !== "" &&
                question.value !== null
            ) {
                answeredQuestions++;
            }

        });

        if (answeredQuestions > 0) {

            availableSignals++;

        }

    }


    // 2. Journal / NLP text
    const journal =
        document.getElementById("journal");

    if (
        journal &&
        journal.value.trim().length >= 10
    ) {

        availableSignals++;

    }


    // 3. Sleep
    const sleep =
        document.getElementById("sleep");

    if (
        sleep &&
        sleep.value !== ""
    ) {

        availableSignals++;

    }


    // 4. Activity
    const activity =
        document.getElementById("activity");

    if (
        activity &&
        activity.value !== ""
    ) {

        availableSignals++;

    }


    // 5. Screen time / behavioural signal
    const screen =
        document.getElementById("screen");

    if (
        screen &&
        screen.value !== ""
    ) {

        availableSignals++;

    }


    // Calculate confidence
    confidence =
        50 +
        (
            availableSignals /
            totalSignals
        ) * 45;


    confidence =
        Math.round(
            Math.min(
                95,
                confidence
            )
        );


    // Update value
    confidenceValue.textContent =
        confidence + "%";


    // Update description
    if (confidenceText) {

        if (confidence >= 90) {

            confidenceText.textContent =
                "Strong input coverage";

        }

        else if (confidence >= 75) {

            confidenceText.textContent =
                "Good input coverage";

        }

        else if (confidence >= 60) {

            confidenceText.textContent =
                "Limited input coverage";

        }

        else {

            confidenceText.textContent =
                "More inputs recommended";

        }

    }

}
    // ======================================================
// UPDATE WELLNESS SNAPSHOT
// ======================================================

const snapshotSleep =
    document.getElementById(
        "snapshotSleep"
    );

const snapshotStress =
    document.getElementById(
        "snapshotStress"
    );

const snapshotActivity =
    document.getElementById(
        "snapshotActivity"
    );

const snapshotScreen =
    document.getElementById(
        "snapshotScreen"
    );

const snapshotRecommendation =
    document.getElementById(
        "snapshotRecommendation"
    );


// Sleep
if (snapshotSleep) {

    const latestSleep =
        document.getElementById(
            "sleep"
        )?.value;

    snapshotSleep.textContent =
        latestSleep
            ? Number(latestSleep).toFixed(1) + " hrs"
            : "--";

}


// Stress
if (snapshotStress) {

    const latestStress =
        Number(
            document.getElementById(
                "stress"
            )?.value
        );

    const stressLabels = {

        1: "Low",

        2: "Mild",

        3: "Moderate",

        4: "High",

        5: "Very High"

    };

    snapshotStress.textContent =
        stressLabels[latestStress] || "--";

}


// Activity
if (snapshotActivity) {

    const latestActivity =
        document.getElementById(
            "activity"
        )?.value;

    snapshotActivity.textContent =
        latestActivity
            ? latestActivity + " min"
            : "--";

}


// Screen time
if (snapshotScreen) {

    const latestScreen =
        document.getElementById(
            "screen"
        )?.value;

    snapshotScreen.textContent =
        latestScreen
            ? latestScreen + " hrs"
            : "--";

}


// Recommendation
if (snapshotRecommendation) {

    if (data.score >= 75) {

        snapshotRecommendation.textContent =
            "Your current wellness pattern looks relatively stable. Continue maintaining healthy sleep, activity and relaxation routines.";

    }

    else if (data.score >= 50) {

        snapshotRecommendation.textContent =
            "Consider paying attention to sleep, stress and daily activity. Small routine changes may support better wellness.";

    }

    else {

        snapshotRecommendation.textContent =
            "Your current screening indicator suggests that additional attention may be helpful. Consider speaking with a qualified professional if concerns persist.";

    }

}
}


// ======================================================
// SAVE ASSESSMENT
// ======================================================

async function saveAssessmentToDatabase(data) {

    const response =
        await fetch(
            "/save-assessment",
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(data)
            }
        );


    const result =
        await response.json();


    console.log(
        "DATABASE RESULT:",
        result
    );


    if (!response.ok || !result.success) {

        throw new Error(
            result.message ||
            "Assessment could not be saved."
        );

    }


    return result;
}


// ======================================================
// ASSESSMENT HISTORY
// ======================================================

async function loadAssessmentHistory() {

    const body =
        document.getElementById(
            "assessmentHistoryBody"
        );

    if (!body) return;


    try {

        const response =
            await fetch(
                "/assessment-history",
                {
                    cache: "no-store"
                }
            );


        const result =
            await response.json();


        if (
            !result.success ||
            !result.assessments ||
            result.assessments.length === 0
        ) {

            body.innerHTML = `
                <tr>
                    <td colspan="6" class="history-empty">
                        No previous assessments yet &mdash; run an
                        assessment from <b>Data Collection</b> to start
                        your wellness timeline.
                    </td>
                </tr>
            `;

            const cnt =
                document.getElementById("historyCount");
            if (cnt) cnt.textContent = "0 records";

            const wrapEl0 = body.closest(".table-wrap");
            if (wrapEl0) { wrapEl0.style.maxHeight = ""; wrapEl0.style.overflowY = ""; }

            return;
        }

        const list = result.assessments;
        const cnt2 =
            document.getElementById("historyCount");
        if (cnt2) {
            cnt2.textContent =
                list.length +
                (list.length === 1 ? " record" : " records");
        }

        body.innerHTML =
            list.map(
                item => {



const date = item.created_at;

                    const hrVal =
                        item.heart_rate != null
                            ? Math.round(Number(item.heart_rate))
                            : null;

                    const sleepVal =
                        item.sleep_hours != null
                            ? Number(item.sleep_hours).toFixed(1)
                            : null;

                    const stressLabels = {
                        "1": "Low",
                        "2": "Mild",
                        "3": "Moderate",
                        "4": "High",
                        "5": "Very High"
                    };
                    const stressLevel =
                        String(item.stress_level);

                    const stressLabel =
                        stressLabels[stressLevel] ||
                        (item.stress_level != null
                            ? "Level " + stressLevel
                            : "—");

                    return `
                        <tr>

                            <td>
                                ${date}
                            </td>

                            <td>
    <span class="history-score">
        ${Math.round(Number(item.wellness_score))}
    </span>
</td>

                            <td>

    <span class="history-risk ${
        String(item.risk_level)
            .toLowerCase()
            .replace(/\s+/g, "-")
    }">

        ${item.risk_level}

    </span>

</td>

                            <td>
                                ${hrVal != null ? hrVal : "—"}
                            </td>

                            <td>
                                ${sleepVal != null ? sleepVal + " hrs" : "—"}
                            </td>

                            <td>
    <span class="history-stress stress-${stressLevel}">
        ${stressLabel}
    </span>
</td>

                        </tr>
                    `;

                }
            ).join("");

        const wrapEl = body.closest(".table-wrap");
        if (wrapEl) {
            wrapEl.style.maxHeight = "";
            wrapEl.style.overflowY = "";
            if (body.querySelectorAll("tr").length > 6) {
                wrapEl.style.maxHeight = "480px";
                wrapEl.style.overflowY = "auto";
            }
        }

} catch (error) {

    console.error(
        "History error:",
        error
    );


    body.innerHTML = `
            <tr>
                <td colspan="6" class="history-empty">
                    ❌ Unable to load assessment history.
                </td>
            </tr>
        `;

    }
}

// ======================================================
// LOAD LATEST ASSESSMENT FOR REPORTS
// ======================================================

async function loadLatestAssessment() {

    try {

        const response =
            await fetch(
                "/assessment-history",
                {
                    cache: "no-store"
                }
            );

        const result =
            await response.json();

        if (
            !result.success ||
            !result.assessments ||
            result.assessments.length === 0
        ) {
            return;
        }

        // First record = newest assessment
        const latest =
            result.assessments[0];

        const score =
            Number(
                latest.wellness_score
            );

        state.score = score;

        const risk =
            latest.risk_level;
            // Restore latest assessment into the main UI
if (
    score !== undefined &&
    !isNaN(score)
) {

    const riskNumber =
        100 - score;

    const breakdown =
        latest.risk_breakdown &&
        typeof latest.risk_breakdown === "object"
            ? latest.risk_breakdown
            : {};

    updateUI({
        score: score,
        risk: riskNumber,
        qPct: Number(breakdown.qPct) || 0,
        sleepRisk: Number(breakdown.sleepRisk) || 0,
        activityRisk: Number(breakdown.activityRisk) || 0,
        screenRisk: Number(breakdown.screenRisk) || 0,
        stressRisk: Number(breakdown.stressRisk) || 0,
        textRisk: Number(breakdown.textRisk) || 0
    });

}

            // Update Reports Current Indicator
const reportRiskElement =
    document.getElementById("riskValue");

const reportRiskTextElement =
    document.getElementById("riskText");

if (reportRiskElement) {
    reportRiskElement.textContent =
        risk || "Unknown";
}

if (reportRiskTextElement) {
    reportRiskTextElement.textContent =
        "Educational screening indicator";
}
            // ======================================================
// REPORT CURRENT INDICATOR + BREAKDOWN
// ======================================================

const reportRiskValue =
    document.getElementById("riskValue");

const reportRiskText =
    document.getElementById("riskText");

const reportGaugeValue =
    document.getElementById("gaugeValue");

const reportGaugeLabel =
    document.getElementById("gaugeLabel");

const reportBars =
    document.getElementById("bars");


// Current Indicator
if (reportRiskValue) {

    reportRiskValue.textContent =
        risk || "Unknown";

}

if (reportRiskText) {

    reportRiskText.textContent =
        "Educational screening indicator";

}


// Gauge
if (reportGaugeValue) {

    reportGaugeValue.textContent =
        score;

}

if (reportGaugeLabel) {

    reportGaugeLabel.textContent =
        (risk || "Unknown") +
        " indicator — not a diagnosis";

}


// Gauge circle
const reportGauge =
    document.querySelector(".gauge");

if (reportGauge) {

    const reportDegrees =
        Math.max(
            0,
            Math.min(
                360,
                score * 3.6
            )
        );

    reportGauge.style.background =
        `conic-gradient(
            #2e79d0 ${reportDegrees}deg,
            var(--gauge-track) ${reportDegrees}deg
        )`;

}


// Assessment Breakdown
if (reportBars) {

    const sleepHours =
        Number(latest.sleep_hours || 0);

    const activityMinutes =
        Number(latest.physical_activity || 0);

    const screenHours =
        Number(latest.screen_time || 0);

    const stressLevel =
        Number(latest.stress_level || 0);


    const reportSleepRisk =
        sleepHours < 5
            ? 85
            : sleepHours < 6
                ? 65
                : sleepHours < 7
                    ? 40
                    : 15;


    const reportActivityRisk =
        activityMinutes < 20
            ? 75
            : activityMinutes < 40
                ? 50
                : activityMinutes < 60
                    ? 30
                    : 15;


    const reportScreenRisk =
        screenHours > 10
            ? 75
            : screenHours > 8
                ? 55
                : screenHours > 6
                    ? 35
                    : 15;


    const reportStressRisk =
        Math.max(
            0,
            Math.min(
                100,
                (stressLevel - 1) * 25
            )
        );


    const reportItems = [

        [
            "Sleep pattern",
            reportSleepRisk
        ],

        [
            "Activity pattern",
            reportActivityRisk
        ],

        [
            "Screen-time pattern",
            reportScreenRisk
        ],

        [
            "Stress input",
            reportStressRisk
        ],

        [
            "Overall risk",
            100 - score
        ]

    ];


    reportBars.innerHTML =
        reportItems.map(
            item => `

                <div class="bar-row">

                    <div class="bar-label">

                        <span>
                            ${item[0]}
                        </span>

                        <b>
                            ${Math.round(item[1])}%
                        </b>

                    </div>

                    <div class="bar-bg">

                        <div
                            class="bar-fill"
                            style="
                                width:${Math.min(
                                    100,
                                    item[1]
                                )}%;
                            ">
                        </div>

                    </div>

                </div>

            `
        ).join("");

}
            // ======================================================
// REPORT CURRENT INDICATOR
// ======================================================

const latestRiskValue =
    document.getElementById("riskValue");

const latestRiskText =
    document.getElementById("riskText");

if (latestRiskValue) {
    latestRiskValue.textContent =
        risk || "Unknown";
}

if (latestRiskText) {
    latestRiskText.textContent =
        "Educational screening indicator";
}


// ======================================================
// REPORT GAUGE
// ======================================================

const latestGaugeValue =
    document.getElementById("gaugeValue");

const latestGaugeLabel =
    document.getElementById("gaugeLabel");

if (latestGaugeValue) {
    latestGaugeValue.textContent =
        score;
}

if (latestGaugeLabel) {
    latestGaugeLabel.textContent =
        (risk || "Unknown") +
        " indicator — not a diagnosis";
}

// ======================================================
// REPORT BREAKDOWN
// ======================================================

const latestBars =
    document.getElementById("bars");
if (latestBars) {

    const sleep =
        Number(latest.sleep_hours || 0);

    const activity =
        Number(latest.physical_activity || 0);

    const screen =
        Number(latest.screen_time || 0);

    const stress =
        Number(latest.stress_level || 0);


    const sleepRisk =
        sleep < 5 ? 85 :
        sleep < 6 ? 65 :
        sleep < 7 ? 40 : 15;


    const activityRisk =
        activity < 20 ? 75 :
        activity < 40 ? 50 :
        activity < 60 ? 30 : 15;


    const screenRisk =
        screen > 10 ? 75 :
        screen > 8 ? 55 :
        screen > 6 ? 35 : 15;


    const stressRisk =
        Math.max(
            0,
            Math.min(
                100,
                (stress - 1) * 25
            )
        );


    const items = [

        ["Sleep pattern", sleepRisk],

        ["Activity pattern", activityRisk],

        ["Screen-time pattern", screenRisk],

        ["Stress input", stressRisk],

        ["Overall risk", 100 - score]

    ];


    latestBars.innerHTML =
        items.map(item => `

            <div class="bar-row">

                <div class="bar-label">

                    <span>
                        ${item[0]}
                    </span>

                    <b>
                        ${Math.round(item[1])}%
                    </b>

                </div>

                <div class="bar-bg">

                    <div
                        class="bar-fill"
                        style="
                            width:${Math.min(
                                100,
                                item[1]
                            )}%;
                        ">
                    </div>

                </div>

            </div>

        `).join("");

}

            // ======================================================
// UPDATE REPORT GAUGE + CURRENT INDICATOR
// ======================================================

const gaugeValue =
    document.getElementById("gaugeValue");

const gaugeLabel =
    document.getElementById("gaugeLabel");

const riskValue =
    document.getElementById("riskValue");

const riskText =
    document.getElementById("riskText");


// Gauge number
if (gaugeValue) {

    gaugeValue.textContent =
        score;

}


// Gauge label
if (gaugeLabel) {

    gaugeLabel.textContent =
        risk +
        " indicator — not a diagnosis";

}


// Current indicator
if (riskValue) {

    riskValue.textContent =
        risk;

}


// Current indicator description
if (riskText) {

    riskText.textContent =
        "Educational screening indicator";

}


// Gauge circle
const gauge =
    document.querySelector(".gauge");

if (gauge) {

    const degrees =
        score * 3.6;

    gauge.style.background =
        `conic-gradient(
            #2e79d0 ${degrees}deg,
            var(--gauge-track) ${degrees}deg
        )`;

}
// ======================================================
// UPDATE REPORT BREAKDOWN
// ======================================================

const bars =
    document.getElementById("bars");

if (bars) {

    const sleepHours =
        Number(latest.sleep_hours || 0);

    const activityMinutes =
        Number(latest.physical_activity || 0);

    const screenHours =
        Number(latest.screen_time || 0);

    const stressLevel =
        Number(latest.stress_level || 0);

    const heartRate =
        Number(latest.heart_rate || 0);


    // Sleep risk
    const sleepRisk =
        sleepHours < 5
            ? 85
            : sleepHours < 6
                ? 65
                : sleepHours < 7
                    ? 40
                    : 15;


    // Activity risk
    const activityRisk =
        activityMinutes < 20
            ? 75
            : activityMinutes < 40
                ? 50
                : activityMinutes < 60
                    ? 30
                    : 15;


    // Screen risk
    const screenRisk =
        screenHours > 10
            ? 75
            : screenHours > 8
                ? 55
                : screenHours > 6
                    ? 35
                    : 15;


    // Stress risk
    const stressRisk =
        Math.max(
            0,
            Math.min(
                100,
                (stressLevel - 1) * 25
            )
        );


    // Heart-rate indicator
    const heartRateRisk =
        heartRate > 100
            ? 70
            : heartRate > 90
                ? 45
                : 20;

    // Social pattern
    const socialVal =
        Number(latest.social_interactions || 0);
    const socialRisk =
        socialVal < 2
            ? 60
            : socialVal < 4
                ? 40
                : 20;

    // Chat-export sentiment from User-Shared Phone Data
    let bdM = latest.risk_breakdown;
    if (typeof bdM === "string") {
        try { bdM = JSON.parse(bdM); } catch (e) { bdM = {}; }
    }
    if (!bdM || typeof bdM !== "object") bdM = {};
    const chatRiskM = Number(bdM.chatRisk) || 0;
    const items = [

        [
            "Sleep pattern",
            sleepRisk
        ],

        [
            "Activity pattern",
            activityRisk
        ],

        [
            "Screen-time pattern",
            screenRisk
        ],

        [
            "Stress input",
            stressRisk
        ],

        [
            "Heart-rate indicator",
            heartRateRisk
        ],

        [
            "Social pattern",
            socialRisk
        ]
    ];

    if (chatRiskM > 0) {
        items.push(["Chat-export sentiment", chatRiskM]);
    }

    items.push(["Overall risk", 100 - score]);


    bars.innerHTML =
        items.map(
            item => `

                <div class="bar-row">

                    <div class="bar-label">

                        <span>
                            ${item[0]}
                        </span>

                        <b>
                            ${Math.round(item[1])}%
                        </b>

                    </div>

                    <div class="bar-bg">

                        <div
                            class="bar-fill"
                            style="
                                width:${Math.min(
                                    100,
                                    item[1]
                                )}%;
                            ">
                        </div>

                    </div>

                </div>

            `
        ).join("");

}

        // REPORT PILL
        const reportPill =
            document.getElementById(
                "reportPill"
            );

        if (reportPill) {

            reportPill.textContent =
                risk + " Indicator";

        }


        // REPORT TITLE
        const reportTitle =
            document.getElementById(
                "reportTitle"
            );

        if (reportTitle) {

            reportTitle.textContent =
                risk +
                " wellness-risk indicator";

        }


        // REPORT SCORE
        const reportScore =
            document.getElementById(
                "reportScore"
            );

        if (reportScore) {

            reportScore.textContent =
                score.toFixed(2);

        }

        applyReportRisk(score, risk);


        // REPORT SUMMARY
        const reportSummary =
            document.getElementById(
                "reportSummary"
            );

        if (reportSummary) {

            reportSummary.textContent =
                "Your latest wellness assessment produced a wellness score of " +
                score.toFixed(2) +
                "/100.";

        }


        // RECOMMENDATION
        const recommendation =
            document.getElementById(
                "recommendation"
            );


        if (recommendation) {

            if (risk === "Low") {

                recommendation.textContent =
                    "Continue healthy routines and monitor changes over time.";

            }

            else if (risk === "Moderate") {

                recommendation.textContent =
                    "Consider reviewing sleep, stress and daily routines.";

            }

            else {

                recommendation.textContent =
                    "Consider discussing persistent concerns with a qualified professional. This result is not a diagnosis.";

            }

        }

    }

    catch (error) {

        console.error(
            "Reports loading error:",
            error
        );

    }

}

// ======================================================
// CHARTS
// ======================================================

let trendChart = null;
let monitorChart = null;


function makeCharts() {

    if (typeof Chart === "undefined") {
        return;
    }


    const trendCanvas =
        document.getElementById(
            "trendChart"
        );

    const monitorCanvas =
        document.getElementById(
            "monitorChart"
        );


    const options = {

        responsive: true,

        plugins: {

            legend: {
                display: false
            }

        },

        scales: {

            y: {
                min: 0,
                max: 100
            }

        }

    };




    if (monitorCanvas) {

        monitorChart =
            new Chart(
                monitorCanvas,
                {

                    type: "line",

                    data: {

                        labels: [
                            "10 AM",
                            "12 PM",
                            "2 PM",
                            "4 PM",
                            "6 PM",
                            "8 PM"
                        ],

                        datasets: [

                            {
                                data: [
                                    70,
                                    67,
                                    65,
                                    69,
                                    63,
                                    64
                                ],

                                borderWidth: 2,
                                tension: 0.35,
                                fill: false
                            }

                        ]

                    },

                    options: options

                }

            );

    window.monitorChart = monitorChart;

    }

}

function updateCharts(score) {

    if (trendChart) {

        trendChart.data.datasets[0]
            .data[
                trendChart.data.datasets[0].data.length - 1
            ] = score;

        trendChart.update();
    }


    if (monitorChart) {

        monitorChart.data.datasets[0]
            .data[5] = score;

        monitorChart.update();
    }

}


// =========================
// LOAD REAL ASSESSMENT DATA
// =========================

async function loadAnalyticsData() {

    try {

        const response = await fetch("/assessment-history");

        const result = await response.json();

        console.log("Monitoring data:", result);

        if (!result.success) {
            console.error(result.message);
            return;
        }

        if (!result.assessments ||
            result.assessments.length === 0) {

            if (trendChart) {

                trendChart.data.labels = ["No data"];

                trendChart.data.datasets[0].data = [0];

                trendChart.update();
            }

            return;
        }

        // Oldest → newest
        const assessments =
            [...result.assessments].reverse();

        const labels = assessments.map((item) => {

            return new Date(
                item.created_at
            ).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            });

        });

        const scores = assessments.map((item) => {

            return Number(item.wellness_score);

        });

        if (trendChart) {

            trendChart.data.labels = labels;

            trendChart.data.datasets[0].data = scores;

            trendChart.update();

        }

    } catch (error) {

        console.error(
            "Monitoring chart error:",
            error
        );

    }
}

// ======================================================
// CONSENT
// ======================================================

function setupConsent() {

    const button =
        document.getElementById(
            "saveConsentBtn"
        );

    if (!button) return;


    button.addEventListener(
        "click",
        async function () {

            const data = {

                questionnaire:
                    document.getElementById(
                        "consentQuestionnaire"
                    )?.checked || false,

                journal_text:
                    document.getElementById(
                        "consentText"
                    )?.checked || false,

                shared_chat:
                    document.getElementById(
                        "consentChat"
                    )?.checked || false,

                app_usage:
                    document.getElementById(
                        "consentUsage"
                    )?.checked || false,

                notifications:
                    document.getElementById(
                        "consentNotifications"
                    )?.checked || false,

                health_data:
                    document.getElementById(
                        "consentHealth"
                    )?.checked || false

            };


            try {

                const response =
                    await fetch(
                        "/save-consent",
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify(data)
                        }
                    );


                const result =
                    await response.json();


                const status =
                    document.getElementById(
                        "consentStatus"
                    );


                if (status) {

                    status.textContent =
                        result.success
                            ? "✓ Privacy preferences saved"
                            : "✗ " +
                              (
                                  result.message ||
                                  "Unable to save preferences"
                              );

                }

                // Refresh the gating state so Data Collection
                // switches honour the new consent immediately.
                if (result.success && window.loadConsent) {
                    window.loadConsent();
                }


            } catch (error) {

                console.error(
                    "Consent error:",
                    error
                );

            }

        }
    );
}


// ======================================================
// NLP
// ======================================================

function setupNLP() {

    const button =
        document.getElementById(
            "nlpBtn"
        );

    if (!button) return;


    button.addEventListener(
        "click",
        async function () {

            const journal =
                document.getElementById(
                    "journal"
                )?.value.trim() || "";


            if (!journal) {

                alert(
                    "Please enter some journal text first."
                );

                return;
            }


            button.disabled = true;

            button.textContent =
                "🧠 Analyzing...";


            try {

                const response =
                    await fetch(
                        "/analyze-nlp",
                        {

                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    text: journal
                                })

                        }
                    );


                const result =
                    await response.json();


                if (!result.success) {

                    throw new Error(
                        result.message ||
                        "NLP analysis failed."
                    );

                }


                window.nlpTextRisk =
                    Number(
                        result.text_risk
                    );


                const box =
                    document.getElementById(
                        "nlpResult"
                    );

                const sentiment =
                    document.getElementById(
                        "nlpSentiment"
                    );

                const risk =
                    document.getElementById(
                        "nlpRisk"
                    );

                const words =
                    document.getElementById(
                        "nlpWords"
                    );


                if (box) {
                    box.style.display =
                        "block";
                }

                if (sentiment) {
                    sentiment.textContent =
                        result.sentiment;
                }

                if (risk) {
                    risk.textContent =
                        result.text_risk;
                }

                if (words) {
                    words.textContent =
                        result.word_count;
                }


            } catch (error) {

                console.error(
                    "NLP error:",
                    error
                );

                alert(
                    "NLP Error:\n" +
                    error.message
                );

            }


            button.disabled = false;

            button.textContent =
                "🧠 Analyze Journal with NLP";

        }
    );
}
// =========================
// CARE & SUPPORT
// ==========================

function openSupportMessage(title, message) {

    const modal =
        document.getElementById("supportMessageModal");

    const titleElement =
        document.getElementById("supportMessageTitle");

    const messageElement =
        document.getElementById("supportMessageText");

    if (!modal) return;

    if (titleElement) {
        titleElement.textContent = title;
    }

    if (messageElement) {
        messageElement.textContent = message;
    }

    modal.style.display = "flex";
}


function closeSupportMessage() {

    const modal =
        document.getElementById("supportMessageModal");

    if (modal) {
        modal.style.display = "none";
    }

}


window.openSupportMessage = openSupportMessage;
window.closeSupportMessage = closeSupportMessage;

// ======================================================
// FIND PROFESSIONALS USING CURRENT USER LOCATION
// ======================================================

function findClinicians() {

    const results =
        document.getElementById("clinicianResults");

    if (!results) {
        return;
    }

    results.style.display = "block";

    results.innerHTML = `
        <div style="
            padding:16px;
            border-radius:12px;
            background:#f5f8fc;
        ">
            <b>📍 Finding your location...</b>
            <p style="margin:6px 0 0;">
                Please allow location access when your browser asks.
            </p>
        </div>
    `;


    // Check browser support
    if (!navigator.geolocation) {

        results.innerHTML = `
            <div style="
                padding:16px;
                border-radius:12px;
                background:#fff4f4;
            ">
                <b>❌ Location not supported</b>
                <p>
                    Your browser does not support location services.
                </p>
            </div>
        `;

        return;
    }


    // Ask for current location
    navigator.geolocation.getCurrentPosition(

        function(position) {

            const latitude =
                position.coords.latitude;

            const longitude =
                position.coords.longitude;

            const accuracy =
                Math.round(
                    position.coords.accuracy
                );


            console.log(
                "Current latitude:",
                latitude
            );

            console.log(
                "Current longitude:",
                longitude
            );

            console.log(
                "Location accuracy:",
                accuracy + " meters"
            );


            // Google Maps nearby search
            const nearbyURL =
                "https://www.google.com/maps/search/" +
                "?api=1" +
                "&query=mental+health+professional" +
                "&query_place_id=" +
                "";


            results.innerHTML = `

                <div style="
                    padding:16px;
                    border-radius:12px;
                    background:#eef7ff;
                    margin-bottom:12px;
                ">

                    <b>📍 Your Current Location Found</b>

                    <p style="
                        margin:8px 0;
                        font-size:13px;
                    ">
                        Latitude:
                        ${latitude.toFixed(6)}
                        <br>

                        Longitude:
                        ${longitude.toFixed(6)}
                        <br>

                        Accuracy:
                        approximately ${accuracy} meters
                    </p>

                </div>


                <div style="
                    padding:16px;
                    border:1px solid #e5e9ef;
                    border-radius:12px;
                ">

                    <h4 style="margin-top:0;">
                        🩺 Nearby Mental Health Professionals
                    </h4>

                    <p>
                        Search for psychiatrists,
                        psychologists and mental-health
                        services near your current location.
                    </p>

                    <button
                        type="button"
                        class="primary"
                        onclick="
                            window.open(
                                'https://www.google.com/maps/search/psychiatrist/@${latitude},${longitude},13z',
                                '_blank'
                            )
                        "
                        style="margin-top:8px;"
                    >
                        🩺 Find Psychiatrists Nearby
                    </button>


                    <button
                        type="button"
                        class="outline-btn"
                        onclick="
                            window.open(
                                'https://www.google.com/maps/search/psychologist/@${latitude},${longitude},13z',
                                '_blank'
                            )
                        "
                        style="margin-top:8px;"
                    >
                        🧠 Find Psychologists Nearby
                    </button>


                    <button
                        type="button"
                        class="outline-btn"
                        onclick="
                            window.open(
                                'https://www.google.com/maps/search/mental+health+clinic/@${latitude},${longitude},13z',
                                '_blank'
                            )
                        "
                        style="margin-top:8px;"
                    >
                        🏥 Find Mental Health Clinics
                    </button>

                </div>


                <div style="
                    margin-top:12px;
                    padding:14px;
                    border-radius:12px;
                    background:#fff8e8;
                    font-size:13px;
                ">

                    <b>⚠️ Important</b>

                    <p style="margin-bottom:0;">
                        MindWatch only uses your location to
                        help you find nearby services.
                        Always verify the professional's
                        credentials, availability and services
                        before making an appointment.
                    </p>

                </div>
            `;

        },


        // Location error
        function(error) {

            console.error(
                "Location error:",
                error
            );


            let message =
                "Unable to get your current location.";


            if (error.code === 1) {

                message =
                    "Location permission was denied. " +
                    "Please allow location access and try again.";

            }

            else if (error.code === 2) {

                message =
                    "Your location could not be determined. " +
                    "Please check your device location settings.";

            }

            else if (error.code === 3) {

                message =
                    "Location request timed out. " +
                    "Please try again.";

            }


            results.innerHTML = `
                <div style="
                    padding:16px;
                    border-radius:12px;
                    background:#fff4f4;
                ">

                    <b>📍 ${message}</b>

                    <br><br>

                    <button
                        type="button"
                        class="outline-btn"
                        onclick="findClinicians()">
                        🔄 Try Again
                    </button>

                </div>
            `;

        },


        // Location options
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }

    );

}


window.findClinicians =
    findClinicians;
// ======================================================
// AI DIGITAL SUPPORT CHAT
// ======================================================

function openAISupportChat() {

    const chat =
        document.getElementById(
            "aiSupportChat"
        );

    if (!chat) {
        return;
    }

    chat.style.display = "block";

    const input =
        document.getElementById(
            "aiChatInput"
        );

    if (input) {
        input.focus();
    }

}


function closeAISupportChat() {

    const chat =
        document.getElementById(
            "aiSupportChat"
        );

    if (chat) {
        chat.style.display = "none";
    }

}


async function sendAISupportMessage() {

    const input =
        document.getElementById(
            "aiChatInput"
        );

    const messages =
        document.getElementById(
            "aiChatMessages"
        );


    if (!input || !messages) {
        return;
    }


    const text =
        input.value.trim();


    if (!text) {

        alert(
            "Please type a message first."
        );

        return;
    }


    // USER MESSAGE

    messages.innerHTML += `

        <div style="
            background:#2e79d0;
            color:white;
            padding:12px;
            border-radius:12px;
            margin:10px 0 10px auto;
            max-width:85%;
        ">

            <b>You</b><br>

            ${escapeChatText(text)}

        </div>

    `;


    input.value = "";


    // Scroll to bottom

    messages.scrollTop =
        messages.scrollHeight;


    // AI TYPING

    const loading =
        document.createElement("div");


    loading.id =
        "aiTyping";


    loading.style.cssText = `
        background:#eaf3ff;
        padding:12px;
        border-radius:12px;
        margin-bottom:10px;
        max-width:85%;
    `;


    loading.innerHTML =
        "🤖 MindWatch AI is thinking...";


    messages.appendChild(
        loading
    );


    messages.scrollTop =
        messages.scrollHeight;


    try {

        const response =
            await fetch(
                "/ai-support",
                {
                    method:"POST",

                    headers:{
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            message:text
                        })
                }
            );


        const result =
            await response.json();


        const typing =
            document.getElementById(
                "aiTyping"
            );


        if (typing) {
            typing.remove();
        }


        if (!response.ok ||
            !result.success) {

            throw new Error(
                result.message ||
                "AI support unavailable."
            );

        }


        // AI RESPONSE

        messages.innerHTML += `

            <div style="
                background:#eaf3ff;
                padding:12px;
                border-radius:12px;
                margin-bottom:10px;
                max-width:85%;
            ">

                <b>🤖 MindWatch AI</b><br><br>

                ${escapeChatText(
                    result.response
                )}

            </div>

        `;


        messages.scrollTop =
            messages.scrollHeight;


    } catch (error) {

        const typing =
            document.getElementById(
                "aiTyping"
            );


        if (typing) {
            typing.remove();
        }


        messages.innerHTML += `

            <div style="
                background:#fff4f4;
                padding:12px;
                border-radius:12px;
                margin-bottom:10px;
                color:#9b1c1c;
            ">

                ❌ ${escapeChatText(
                    error.message
                )}

            </div>

        `;


        messages.scrollTop =
            messages.scrollHeight;

    }

}


// Prevent HTML injection in chat

function escapeChatText(text) {

    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;")
        .replace(/\n/g, "<br>");

}


window.openAISupportChat =
    openAISupportChat;

window.closeAISupportChat =
    closeAISupportChat;

window.sendAISupportMessage =
    sendAISupportMessage;
    function openAISupportChat() {

    const chat =
        document.getElementById("aiSupportChat");

    if (chat) {

        chat.style.display = "block";

    } else {

        alert("AI chatbot HTML is missing.");

    }
}


function closeAISupportChat() {

    const chat =
        document.getElementById("aiSupportChat");

    if (chat) {

        chat.style.display = "none";

    }
}


async function sendAISupportMessage() {

    const input = document.getElementById("aiChatInput");
    const messages = document.getElementById("aiChatMessages");

    if (!input || !messages) {
        alert("Chatbox not found.");
        return;
    }

    const text = input.value.trim();

    if (!text) {
        alert("Please type a message.");
        return;
    }

    // Show user message
    messages.innerHTML += `
        <div style="
            background:#2e79d0;
            color:white;
            padding:12px;
            border-radius:10px;
            margin:10px 0;
            text-align:right;
        ">
            <b>You:</b><br>
            ${escapeChatText(text)}
        </div>
    `;

    input.value = "";

    // Temporary AI message
    const loading = document.createElement("div");

    loading.id = "aiTyping";

    loading.style.cssText = `
        background:#e8f2ff;
        padding:12px;
        border-radius:10px;
        margin:10px 0;
    `;

    loading.innerHTML = "🤖 MindWatch AI is thinking...";

    messages.appendChild(loading);

    messages.scrollTop = messages.scrollHeight;

    try {

        const response = await fetch("/ai-support", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: text
            })
        });

        const result = await response.json();

        loading.remove();

        if (!response.ok || !result.success) {

            throw new Error(
                result.message || "AI support failed."
            );

        }

        messages.innerHTML += `
            <div style="
                background:#e8f2ff;
                padding:12px;
                border-radius:10px;
                margin:10px 0;
            ">
                🤖 <b>MindWatch AI:</b><br><br>
                ${escapeChatText(result.response)}
            </div>
        `;

        messages.scrollTop = messages.scrollHeight;

    } catch (error) {

        loading.remove();

        messages.innerHTML += `
            <div style="
                background:#fff0f0;
                padding:12px;
                border-radius:10px;
                margin:10px 0;
                color:#9b1c1c;
            ">
                ❌ AI Support Error:<br><br>
                ${escapeChatText(error.message)}
            </div>
        `;

        console.error("AI Support Error:", error);

    }
}

window.sendAISupportMessage = sendAISupportMessage;
// ======================================================
// CLINICIAN / THERAPIST SUPPORT
// ======================================================

let _lastClinicResult = null;


function openClinicianSupport() {

    const box =
        document.getElementById(
            "clinicianSupport"
        );

    if (box) {

        box.style.display = "block";

        box.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    }

    const results =
        document.getElementById("professionalResults");

    if (_lastClinicResult && results) {
        renderNearbyClinics(
            results,
            _lastClinicResult.lat,
            _lastClinicResult.lng,
            _lastClinicResult.clinics,
            _lastClinicResult.locLabel
        );
        return;
    }

    const input = document.getElementById("clinicPlaceInput");
    if (input) {
        input.focus();
        input.select();
    }

}


function quickCitySearch(city) {

    const input = document.getElementById("clinicPlaceInput");
    if (input) { input.value = city; }

    searchClinicsByPlace();

}


window.quickCitySearch = quickCitySearch;


function closeClinicianSupport() {

    const box =
        document.getElementById(
            "clinicianSupport"
        );

    if (box) {

        box.style.display = "none";

    }

}


function findNearbyProfessionals() {

    requestMindWatchLocation();

}


function cancelMindWatchLocation() {

    const results =
        document.getElementById(
            "professionalResults"
        );

    if (results) {

        results.innerHTML = `

            <div style="
                padding:15px;
                background:#f5f8fc;
                border-radius:12px;
            ">

                📍 Location access cancelled.

                <br><br>

                Your location was not requested.

            </div>

        `;

    }

}


function requestMindWatchLocation() {

    const results =
        document.getElementById(
            "professionalResults"
        );

    if (!results) return;

    if (!window.isSecureContext) {
        fallbackToIpLocation();
        return;
    }

    if (!navigator.geolocation) {

        results.innerHTML = `
            <div class="pro-error">
                ❌ Location services are not supported by this browser.
            </div>
        `;

        return;
    }

    results.innerHTML = `
        <div class="pro-loading">📍 Requesting your location...</div>
    `;

    navigator.geolocation.getCurrentPosition(

        function(position) {

            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            loadNearbyClinics(
                results, latitude, longitude,
                "📍 Your exact location (GPS)"
            );

        },

        function(error) {

            console.error("MindWatch location error:", error);
            fallbackToIpLocation();

        },

        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }

    );

}


function showProLoading(container, msg) {
    const listEl = document.getElementById("proList");
    if (listEl) {
        listEl.innerHTML = '<div class="pro-loading">' + msg + '</div>';
    } else {
        container.innerHTML = '<div class="pro-loading">' + msg + '</div>';
    }
}


function showProError(container, msg) {
    const listEl = document.getElementById("proList");
    if (listEl) {
        listEl.innerHTML = '<div class="pro-error">' + msg + '</div>';
    } else {
        container.innerHTML = '<div class="pro-error">' + msg + '</div>';
    }
}


function clinicSourceNote(data) {
    if (!data || data.source !== "DIRECTORY") return "";
    const city = data.fallback_city
        ? " for " + data.fallback_city
        : "";
    if (data.live_unavailable) {
        return "The live map lookup was unreachable, so below are " +
            "known mental-health hospitals / departments" + city +
            ". Please contact them to confirm services.";
    }
    return "No live map results were found nearby, so below are " +
        "known mental-health hospitals / departments" + city + ".";
}


function loadNearbyClinics(container, lat, lng, locLabel) {

    showProLoading(container, "🔄 Searching nearby clinics...");

    fetch(
        "/api/nearby-clinics?lat=" + encodeURIComponent(lat) +
        "&lng=" + encodeURIComponent(lng),
        { cache: "no-store" }
    )
        .then(function(r) { return r.json(); })
        .then(function(data) {

            if (!data.success || !data.clinics ||
                data.clinics.length === 0) {

                showProError(
                    container,
                    "😕 No clinics or professionals found " +
                    "within ~100 km. Try again later."
                );
                return;

            }

            renderNearbyClinics(
                container, lat, lng, data.clinics,
                locLabel ||
                ("📍 Your location detected (" + lat.toFixed(4) +
                 ", " + lng.toFixed(4) + ")"),
                clinicSourceNote(data)
            );

        })
        .catch(function(err) {

            showProError(
                container,
                "❌ Could not load nearby clinics (" +
                (err && err.message ? err.message : "network error") +
                ")."
            );

        });

}


function fallbackToIpLocation() {

    const results =
        document.getElementById("professionalResults");
    if (!results) return;

    showProLoading(
        results,
        "📡 Estimating your location from your network..."
    );

    fetch("https://ipapi.co/json/", { cache: "no-store" })
        .then(function(r) { return r.json(); })
        .then(function(d) {

            if (d && d.latitude && d.longitude) {

                const place = [d.city, d.region, d.country]
                    .filter(Boolean).join(", ");
                loadNearbyClinics(
                    results, d.latitude, d.longitude,
                    "📡 Approximate location (network): " +
                    (place || "unknown")
                );

            } else {

                showProError(
                    results,
                    "❌ Could not determine your location. " +
                    "Please allow location access, or search by city above."
                );

            }

        })
        .catch(function() {

            showProError(
                results,
                "❌ Could not determine your location. " +
                "Please allow location access, or search by city above."
            );

        });

}


function searchClinicsByPlace() {

    const input = document.getElementById("clinicPlaceInput");
    const results = document.getElementById("professionalResults");
    if (!input || !results) return;

    const q = input.value.trim();
    if (!q) {
        results.innerHTML =
            '<div class="pro-error">Please enter a city or area.</div>';
        return;
    }

    showProLoading(
        results,
        '🔄 Searching clinics near "' + escapeHtml(q) + '"...'
    );

    fetch(
        "/api/nearby-clinics?q=" + encodeURIComponent(q),
        { cache: "no-store" }
    )
        .then(function(r) { return r.json(); })
        .then(function(data) {

            if (!data.success || !data.clinics ||
                data.clinics.length === 0) {

                showProError(
                    results,
                    '😕 No mental-health professionals found near "' +
                    escapeHtml(q) +
                    '". Try a bigger city or use your current location.'
                );
                return;

            }

            renderNearbyClinics(
                results, data.lat, data.lng, data.clinics,
                "🔎 Search area: " + escapeHtml(q),
                clinicSourceNote(data)
            );

        })
        .catch(function(err) {

            showProError(
                results,
                "❌ Could not search (" +
                (err && err.message ? err.message : "network error") +
                ")."
            );

        });

}


function renderNearbyClinics(container, lat, lng, clinics, locLabel, sourceNote) {

    if (!locLabel) {
        locLabel = "📍 Your location detected (" +
            lat.toFixed(4) + ", " + lng.toFixed(4) + ")";
    }

    let mapEl = document.getElementById("proMap");
    let listEl = document.getElementById("proList");
    let locEl = document.getElementById("proLoc");

    if (!mapEl || !listEl || !locEl) {

        container.innerHTML = `
            ${sourceNote ? '<div class="pro-notice">' + sourceNote + '</div>' : ''}
            <div id="proLoc" class="pro-loc"></div>

            <div id="proMap" class="pro-map"></div>

            <p class="pro-hint">🖱️ Drag the pin or click the map to set
                your <b>exact</b> location, then we find the nearest
                hospitals there.</p>

            <h4 class="pro-heading">Mental-health professionals</h4>
            <p class="pro-sub">${clinics.length} mental-health professionals
                found nearby, listed by distance (closest first).</p>

            <div id="proList" class="pro-list"></div>
        `;

        mapEl = document.getElementById("proMap");
        listEl = document.getElementById("proList");
        locEl = document.getElementById("proLoc");

        initProMap(mapEl, lat, lng, clinics);

    } else {

        updateProMap(lat, lng, clinics);

    }

    const mapUrl =
        "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("mental health clinic") + "@" +
        lat + "," + lng;

    locEl.innerHTML = locLabel +
        ' <a class="pro-maplink" href="' + mapUrl +
        '" target="_blank" rel="noopener">' +
        "Open area in Google Maps</a>";

    listEl.innerHTML = clinics.map(renderClinicCard).join("");

    _lastClinicResult = {
        lat: lat,
        lng: lng,
        clinics: clinics,
        locLabel: locLabel
    };

}


function reloadClinicsAt(lat, lng) {

    const results =
        document.getElementById("professionalResults");
    if (!results) return;

    loadNearbyClinics(
        results, lat, lng,
        "📍 Location set — drag the pin to adjust"
    );

}


function initProMap(el, lat, lng, clinics) {

    if (!el) return;

    if (typeof L === "undefined") {
        el.innerHTML = '<div class="pro-loading">' +
            "🗺️ Map unavailable (no internet connection).</div>";
        return;
    }

    const map = L.map(el).setView([lat, lng], 13);

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: "&copy; OpenStreetMap" }
    ).addTo(map);

    const clinicLayer = L.layerGroup().addTo(map);

    const userMarker = L.marker([lat, lng], { draggable: true })
        .addTo(map)
        .bindPopup("📍 Your location — drag me to your exact spot")
        .openPopup();

    userMarker.on("dragend", function(e) {
        const p = e.target.getLatLng();
        reloadClinicsAt(p.lat, p.lng);
    });

    map.on("click", function(e) {
        const p = e.latlng;
        userMarker.setLatLng(p);
        reloadClinicsAt(p.lat, p.lng);
    });

    window._proState = {
        map: map,
        userMarker: userMarker,
        clinicLayer: clinicLayer
    };

    addClinicMarkers(clinics);

    setTimeout(function() { map.invalidateSize(); }, 150);

}


function addClinicMarkers(clinics) {

    const st = window._proState;
    if (!st) return;

    st.clinicLayer.clearLayers();

    clinics.forEach(function(c) {
        L.marker([c.lat, c.lng]).addTo(st.clinicLayer)
            .bindPopup(
                "<b>" + escapeHtml(c.name) + "</b><br>" +
                escapeHtml(c.type) + "<br>" +
                c.distance_km + " km away"
            );
    });

}


function updateProMap(lat, lng, clinics) {

    const st = window._proState;
    if (!st || !st.map) {
        const el = document.getElementById("proMap");
        if (el) initProMap(el, lat, lng, clinics);
        return;
    }

    st.userMarker.setLatLng([lat, lng]);
    st.map.setView([lat, lng], 13);
    addClinicMarkers(clinics);

    setTimeout(function() { st.map.invalidateSize(); }, 150);

}


function renderClinicCard(c) {

    const m = "https://www.google.com/maps/?q=" + c.lat + "," + c.lng;

    return `
        <div class="pro-card">
            <div class="pro-badge">📍</div>
            <div class="pro-info">
                <h4>${escapeHtml(c.name)}</h4>
                <div class="pro-type">${escapeHtml(c.type)}</div>
                <div class="pro-spec">${escapeHtml(c.address)}</div>
                <div class="pro-contact">
                    ${c.email ? '✉️ <span>' + escapeHtml(c.email) + '</span>' : ''}
                    ${c.phone ? '📞 <span>' + escapeHtml(c.phone) + '</span>' : ''}
                    ${c.website ? '🌐 <a href="' + encodeURI(c.website) + '" target="_blank" rel="noopener">Website</a>' : ''}
                </div>
                <span class="pro-distance">${c.distance_km} km away</span>
                <div class="pro-actions">
                    <a class="primary pro-btn" href="${m}"
                       target="_blank" rel="noopener">🗺️ View Location</a>
                    <button type="button" class="outline-btn pro-btn"
                       data-name="${escapeHtml(c.name)}"
                       data-email="${escapeHtml(c.email)}"
                       data-phone="${escapeHtml(c.phone)}"
                       onclick="messageProfessionalBtn(this)">📨 Message</button>
                </div>
            </div>
        </div>
    `;

}


function escapeHtml(s) {
    return String(s == null ? "" : s).replace(
        /[&<>"']/g,
        function(ch) {
            return {
                "&": "&amp;", "<": "&lt;", ">": "&gt;",
                '"': "&quot;", "'": "&#39;"
            }[ch];
        }
    );
}


window.findNearbyProfessionals =
    findNearbyProfessionals;

window.requestMindWatchLocation =
    requestMindWatchLocation;

window.cancelMindWatchLocation =
    cancelMindWatchLocation;
    // ======================================================
// PERSONALIZED CARE / INSIGHTS
// ======================================================

function generatePersonalizedCare() {

    const resultBox =
        document.getElementById("personalizedCareResult");

    if (!resultBox) return;


    // Get latest assessment values
    const score =
        Number(
            state?.score ??
            window.wellnessScore ??
            document.getElementById("wellnessScore")?.textContent ??
            0
        );


    const riskElement =
        document.getElementById("riskLevel");

    const risk =
        riskElement
            ? riskElement.textContent.trim().toLowerCase()
            : "";


    let title =
        "🌱 Your Personalized Wellness Suggestions";

    let suggestions = [];


    // LOW RISK
    if (
        risk.includes("low") ||
        (score > 0 && score >= 70)
    ) {

        title =
            "🟢 Your Wellness Pattern Looks Stable";

        suggestions = [

            "😴 Maintain a regular sleep schedule.",

            "🚶 Include some physical activity in your daily routine.",

            "📝 Continue journaling or checking in with yourself.",

            "🧘 Try short breathing or relaxation exercises.",

            "💬 Continue monitoring your wellness patterns regularly."

        ];

    }


    // MODERATE RISK
    else if (
        risk.includes("moderate") ||
        risk.includes("medium") ||
        (score > 0 && score >= 40)
    ) {

        title =
            "🟡 Some Areas May Need Attention";

        suggestions = [

            "😴 Try to maintain consistent sleep and rest.",

            "🧘 Practice a short breathing or relaxation exercise each day.",

            "📝 Write down situations that increase stress.",

            "🚶 Take regular breaks and include light physical activity.",

            "🩺 If these concerns continue, consider speaking with a qualified professional."

        ];

    }


    // HIGH RISK
    else if (
        risk.includes("high") ||
        risk.includes("elevated") ||
        (score > 0 && score < 40)
    ) {

        title =
            "🔴 Your Results Suggest Extra Support May Be Helpful";

        suggestions = [

            "🧘 Take time to rest and use calming activities.",

            "💬 Talk with someone you trust about how you are feeling.",

            "🩺 Consider discussing your concerns with a qualified mental-health professional.",

            "📊 Continue monitoring your wellness indicators.",

            "🚨 If you are in immediate danger or may hurt yourself or someone else, seek urgent local help rather than relying on this application."

        ];

    }


    // NO ASSESSMENT
    else {

        title =
            "📋 Complete an Assessment First";

        suggestions = [

            "Complete the AI screening to generate personalized suggestions.",

            "Your suggestions will be based on your latest wellness indicators.",

            "Your assessment data can then be reviewed in Reports & Insights."

        ];

    }


    resultBox.innerHTML = `

        <div style="
            margin-top:20px;
            padding:20px;
            background:#f5f8fc;
            border:1px solid #e1e7ef;
            border-radius:16px;
        ">

            <h3 style="margin-top:0;">
                ${title}
            </h3>

            <div style="
                margin-top:15px;
            ">

                ${suggestions.map(
                    suggestion => `
                        <div style="
                            padding:12px;
                            margin:8px 0;
                            background:white;
                            border-radius:10px;
                            border:1px solid #e5e7eb;
                        ">
                            ${suggestion}
                        </div>
                    `
                ).join("")}

            </div>

            <p style="
                margin-top:15px;
                font-size:13px;
                color:#6b7280;
            ">
                MindWatch provides educational wellness guidance
                and is not a medical diagnosis.
            </p>

        </div>

    `;


    resultBox.scrollIntoView({
        behavior: "smooth",
        block: "center"
    });

}


window.generatePersonalizedCare =
    generatePersonalizedCare;
    // ======================================================
// PERSONALIZED INSIGHTS BUTTON
// ======================================================

document.addEventListener("DOMContentLoaded", function () {

    const button =
        document.getElementById("personalizedCareBtn");

    if (!button) {
        console.error("Personalized Insights button not found.");
        return;
    }

    button.addEventListener("click", function () {

        const resultBox =
            document.getElementById(
                "personalizedCareResult"
            );

        if (!resultBox) {
            alert("Personalized Insights area not found.");
            return;
        }

        const score =
            Number(state.score);

        if (!state.score) {

            resultBox.innerHTML = `
                <div style="
                    margin-top:20px;
                    padding:20px;
                    background:#f5f8fc;
                    border-radius:14px;
                ">
                    <h3>📋 Complete an Assessment First</h3>

                    <p>
                        Run the AI screening first.
                        Your personalized suggestions will
                        then be based on your latest result.
                    </p>

                    <button
                        type="button"
                        class="primary"
                        onclick="showPage('collection')">
                        🧠 Go to Assessment
                    </button>
                </div>
            `;

            return;
        }


        let title;
        let suggestions;


        if (score >= 70) {

            title =
                "🟢 Your Wellness Pattern Looks Stable";

            suggestions = [
                "😴 Maintain a regular sleep schedule.",
                "🚶 Continue regular physical activity.",
                "📝 Keep using journaling to check in with yourself.",
                "🧘 Try short breathing or relaxation exercises.",
                "📊 Continue monitoring your wellness patterns."
            ];

        }

        else if (score >= 40) {

            title =
                "🟡 Some Areas May Need Attention";

            suggestions = [
                "😴 Try to maintain consistent sleep and rest.",
                "🧘 Practice a short relaxation or breathing exercise.",
                "📝 Write down situations that increase your stress.",
                "🚶 Take regular breaks and include light activity.",
                "🩺 Consider professional support if concerns continue."
            ];

        }

        else {

            title =
                "🔴 Extra Support May Be Helpful";

            suggestions = [
                "🧘 Give yourself time for rest and calming activities.",
                "💬 Consider talking with someone you trust.",
                "🩺 Consider speaking with a qualified mental-health professional.",
                "📊 Continue monitoring your wellness indicators.",
                "🚨 If you are in immediate danger, seek urgent local help."
            ];

        }


        resultBox.innerHTML = `

            <div style="
                margin-top:20px;
                padding:20px;
                background:#f5f8fc;
                border:1px solid #e1e7ef;
                border-radius:16px;
            ">

                <h3>${title}</h3>

                <p>
                    Based on your latest wellness score:
                    <strong>${score}/100</strong>
                </p>

                ${suggestions.map(function(item) {

                    return `
                        <div style="
                            padding:12px;
                            margin:8px 0;
                            background:white;
                            border-radius:10px;
                        ">
                            ${item}
                        </div>
                    `;

                }).join("")}

                <p style="
                    margin-top:15px;
                    font-size:13px;
                    color:#6b7280;
                ">
                    MindWatch provides educational wellness
                    guidance and is not a medical diagnosis.
                </p>

            </div>
        `;

        resultBox.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

    });

});
// ======================================================
// FINAL PERSONALIZED INSIGHTS
// ======================================================

document.addEventListener("DOMContentLoaded", function () {

    const button =
        document.getElementById("personalizedCareBtn");

    if (!button) return;

    button.onclick = function () {

        const resultBox =
            document.getElementById(
                "personalizedCareResult"
            );

        if (!resultBox) {
            alert("Personalized Insights area not found.");
            return;
        }

        // Get the latest score directly from the dashboard
        const scoreElement =
            document.getElementById("wellnessValue");

        let score = 0;

        if (scoreElement) {
            score =
                Number(
                    scoreElement.textContent.trim()
                );
        }

        // Also check state
        if (
            (!score || isNaN(score)) &&
            state.score !== null
        ) {
            score = Number(state.score);
        }


        // No assessment
        if (
            !score ||
            isNaN(score) ||
            score <= 0 ||
            score > 100
        ) {

            resultBox.innerHTML = `
                <div style="
                    margin-top:20px;
                    padding:20px;
                    background:#fff8e8;
                    border-radius:14px;
                    border:1px solid #f0d98c;
                ">

                    <h3>📋 Complete AI Screening First</h3>

                    <p>
                        Please run the AI screening first.
                    </p>

                    <button
                        type="button"
                        class="primary"
                        onclick="showPage('collection')">
                        🧠 Run AI Screening
                    </button>

                </div>
            `;

            return;
        }


        let title = "";
        let suggestions = [];


        // LOW
        if (score >= 70) {

            title =
                "🟢 Low-Risk Wellness Pattern";

            suggestions = [

                "😴 Maintain a regular sleep schedule.",

                "🚶 Continue regular physical activity.",

                "🧘 Continue relaxation or breathing exercises.",

                "📝 Keep journaling and checking in with yourself.",

                "📊 Continue monitoring your wellness over time."

            ];

        }


        // MODERATE
        else if (score >= 40) {

            title =
                "🟡 Moderate-Risk Wellness Pattern";

            suggestions = [

                "😴 Give more attention to your sleep routine.",

                "🧘 Try a short breathing or relaxation exercise every day.",

                "📱 Consider reducing excessive screen time.",

                "🚶 Include regular physical activity and breaks.",

                "🩺 If concerns continue, consider speaking with a qualified professional."

            ];

        }


        // HIGH
        else {

            title =
                "🔴 Higher-Risk Wellness Pattern";

            suggestions = [

                "😴 Prioritize adequate rest and sleep.",

                "🧘 Use calming activities such as breathing exercises.",

                "💬 Consider talking with someone you trust.",

                "🩺 Consider speaking with a qualified mental-health professional.",

                "🚨 If you are in immediate danger, seek urgent local help."

            ];

        }


        resultBox.innerHTML = `

            <div style="
                margin-top:20px;
                padding:22px;
                background:#f5f8fc;
                border:1px solid #dfe6ee;
                border-radius:16px;
            ">

                <h3>
                    ${title}
                </h3>

                <div style="
                    margin:10px 0 18px;
                    font-size:18px;
                ">
                    Wellness Score:
                    <strong>${score}/100</strong>
                </div>

                <h4>
                    💡 Recommended Actions
                </h4>

                ${suggestions.map(function (item) {

                    return `
                        <div style="
                            padding:13px;
                            margin:8px 0;
                            background:white;
                            border-radius:10px;
                            border:1px solid #e5e7eb;
                        ">
                            ${item}
                        </div>
                    `;

                }).join("")}

                <p style="
                    margin-top:18px;
                    font-size:13px;
                    color:#6b7280;
                ">
                    This is an educational wellness indicator,
                    not a medical diagnosis.
                </p>

            </div>
        `;

        resultBox.scrollIntoView({
            behavior: "smooth",
            block: "center"
        });

    };

});
// ======================================================
// REAL ASSESSMENT WELLNESS TREND
// ======================================================

let wellnessTrendChart = null;


async function loadWellnessTrend() {

    const canvas =
        document.getElementById("trendChart");

    if (!canvas) return;


    try {

        const response =
            await fetch(
                "/assessment-history",
                {
                    cache: "no-store"
                }
            );


        const result =
            await response.json();


        if (
            !result.success ||
            !result.assessments ||
            result.assessments.length === 0
        ) {

            if (trendChart) {

                trendChart.destroy();

                trendChart = null;

            }

            return;
        }


        const assessments =
            result.assessments
                .slice()
                .reverse();


        const labels =
            assessments.map(function (item) {

                return new Date(
                    item.created_at
                ).toLocaleDateString();

            });


        const scores =
            assessments.map(function (item) {

                return Number(
                    item.wellness_score
                );

            });


        const ctx =
            canvas.getContext("2d");


        if (trendChart) {

            trendChart.destroy();

        }


        trendChart =
            new Chart(
                ctx,
                {

                    type: "line",

                    data: {

                        labels: labels,

                        datasets: [

                            {
                                label:
                                    "Wellness Score",

                                data:
                                    scores,

                                tension: 0.35,

                                fill: true,

                                borderWidth: 3,

                                pointRadius: 5

                            }

                        ]

                    },

                    options: {

                        responsive: true,

                        maintainAspectRatio: false,

                        scales: {

                            y: {

                                min: 0,

                                max: 100,

                                title: {

                                    display: true,

                                    text:
                                        "Wellness Score"

                                }

                            },

                            x: {

                                title: {

                                    display: true,

                                    text:
                                        "Assessment Date"

                                }

                            }

                        },

                        plugins: {

                            legend: {

                                display: true

                            },

                            tooltip: {

                                callbacks: {

                                    label:
                                        function(context) {

                                            return (
                                                " Wellness Score: " +
                                                context.raw
                                            );

                                        }

                                }

                            }

                        }

                    }

                }

            );

    window.trendChart = trendChart;


    } catch (error) {

        console.error(
            "Wellness trend error:",
            error
        );

    }

}


// Load trend when page opens

document.addEventListener(
    "DOMContentLoaded",
    function() {

        loadWellnessTrend();
        drawOverviewChart();

    }
);

// Draw the original "Monitoring Overview" demo chart on the dashboard
function drawOverviewChart() {

    var canvas = document.getElementById("overviewChart");
    if (!canvas || typeof Chart === "undefined") return;

    var existing =
        (typeof Chart.getChart === "function")
            ? Chart.getChart(canvas)
            : null;

    if (existing && typeof existing.destroy === "function") {
        existing.destroy();
    }

    window.__overviewChartInstance = null;

    try {

        var ctx = canvas.getContext("2d");
        window.__overviewChartInstance =
            new Chart(
                ctx,
                {
                    type: "line",
                    data: {
                        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
                        datasets: [
                            {
                                label: "Wellness",
                                data: [72, 68, 74, 70, 76, 73, 78],
                                borderColor: "#2467c5",
                                backgroundColor: "rgba(36,103,197,0.12)",
                                tension: 0.35,
                                fill: true,
                                pointRadius: 3
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true, max: 100 } }
                    }
                }
            );

    } catch (err) {

        console.error("Overview chart error:", err);

    }
}


// Reload trend whenever assessment history
// is requested again

window.loadWellnessTrend =
    loadWellnessTrend;
   // ======================================================
// LOGOUT
// ======================================================

const logoutBtn =
    document.getElementById("logoutBtn");

const logoutModal =
    document.getElementById("logoutModal");

function openLogoutModal() {
    if (logoutModal) {
        logoutModal.style.display = "flex";
    }
}

function closeLogoutModal() {
    if (logoutModal) {
        logoutModal.style.display = "none";
    }
    // Make sure the page behind the modal is fully populated/visible
    // again (in case it looked empty after the modal closed).
    var cur = getCurrentPage();
    if (cur) {
        refreshSection(cur);
    }
}

if (logoutBtn) {

    logoutBtn.addEventListener(
        "click",
        function (event) {

            event.preventDefault();
            openLogoutModal();

        }
    );

}

const confirmLogoutBtn =
    document.getElementById("confirmLogout");

if (confirmLogoutBtn) {

    confirmLogoutBtn.addEventListener(
        "click",
        function () {

            closeLogoutModal();

            const form =
                document.createElement("form");
            form.method = "POST";
            form.action = "/logout";
            document.body.appendChild(form);
            form.submit();

        }
    );

}

const cancelLogoutBtn =
    document.getElementById("cancelLogout");

if (cancelLogoutBtn) {

    cancelLogoutBtn.addEventListener(
        "click",
        function () {

            closeLogoutModal();

        }
    );

}
// ======================================================
// START ASSESSMENT BUTTON
// ======================================================

document.addEventListener("DOMContentLoaded", function () {

    const startAssessmentBtn =
        document.getElementById("startAssessmentBtn");

    if (!startAssessmentBtn) {
        console.error("Start Assessment button not found");
        return;
    }

    startAssessmentBtn.addEventListener("click", function (event) {

        event.preventDefault();

        console.log("START ASSESSMENT BUTTON CLICKED");

        // Go to Data Collection / Assessment page
        if (typeof showPage === "function") {

            showPage("data");

        } else {

            console.error("showPage() function not found");

        }

    });

});
// ======================================================
// START ASSESSMENT BUTTON
// ======================================================

document.addEventListener("DOMContentLoaded", function () {

    const startBtn =
        document.getElementById("startAssessmentBtn");

    if (!startBtn) {
        console.error("Start Assessment button not found");
        return;
    }

    startBtn.addEventListener("click", function () {

        console.log("START ASSESSMENT CLICKED");

        const pages =
            document.querySelectorAll(".page");

        pages.forEach(function (page) {
            page.classList.remove("active-page");
        });

       const dataPage =
    document.getElementById("data");

if (!dataPage) {
    console.error("Data page not found");
    return;
}

dataPage.classList.add("active-page");

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

    });

});
// START ASSESSMENT
var pageMeta = {
    dashboard: {
        eyebrow: "DASHBOARD",
        title: "MindWatch",
        subtitle: "AI-based continuous monitoring of consented mental-health indicators."
    },
    data: {
        eyebrow: "DATA COLLECTION",
        title: "MindWatch",
        subtitle: "Collect the three input categories represented in your architecture."
    },
    alerts: {
        eyebrow: "ALERTS & REMINDERS",
        title: "MindWatch",
        subtitle: "Risk alerts with supportive guidance, plus daily check-in reminders."
    },
    reports: {
        eyebrow: "REPORTS & INSIGHTS",
        title: "MindWatch",
        subtitle: "A simple output screen for users and clinicians."
    },
    history: {
        eyebrow: "ASSESSMENT HISTORY",
        title: "MindWatch",
        subtitle: "View your previous mental-health monitoring assessments."
    },
    support: {
        eyebrow: "CARE / SUPPORT",
        title: "MindWatch",
        subtitle: "Connect users with appropriate next steps."
    }
};

window.showPage = function(pageId) {

    if (!pageId) return;

    console.log("Opening:", pageId);

    document.querySelectorAll(".page").forEach(function(page) {
        page.classList.remove("active-page");
    });

    const page = document.getElementById(pageId);

    if (!page) {
        console.error("Cannot find page:", pageId);
        return;
    }

    page.classList.add("active-page");

    document.querySelectorAll(".nav-item").forEach(function(item) {
        item.classList.remove("active");
    });

    var selectedNav = document.querySelector('.nav-item[data-page="' + pageId + '"]');
    if (selectedNav) {
        selectedNav.classList.add("active");
    }

    var meta = pageMeta[pageId];
    if (meta) {
        var eyebrow = document.getElementById("pageEyebrow");
        var title = document.getElementById("pageTitle");
        var subtitle = document.getElementById("pageSubtitle");
        if (eyebrow) { eyebrow.textContent = meta.eyebrow; }
        if (title) { title.textContent = meta.title; }
        if (subtitle) { subtitle.textContent = meta.subtitle; }
    }

    // Refresh the Risk Alerts panel whenever that page is opened
    if (pageId === "alerts" && window.__updateRiskAlertUI) {
        window.__updateRiskAlertUI(window.__latestRisk);
    }

    window.scrollTo(0, 0);
};
// ======================================================
// SIDEBAR NAVIGATION
// ======================================================

document.querySelectorAll(".nav-item[data-page]").forEach(function(item) {

    item.addEventListener("click", function() {

        const pageId = this.dataset.page;

        showPage(pageId);

    });

});

// ======================================================
// START ASSESSMENT BUTTON
// ======================================================

document.addEventListener("DOMContentLoaded", function () {

    const startBtn =
        document.getElementById("startAssessmentBtn");

    if (!startBtn) {
        console.error("Start Assessment button not found");
        return;
    }

    startBtn.addEventListener("click", function () {

        console.log("START ASSESSMENT CLICKED");

        // Hide all pages
        document.querySelectorAll(".page").forEach(function (page) {
            page.classList.remove("active-page");
        });

        // Remove sidebar highlight from ALL buttons
        document.querySelectorAll(".nav-item").forEach(function (item) {
            item.classList.remove("active");
        });

        // Show DATA COLLECTION
        const dataPage =
            document.getElementById("data");

        if (!dataPage) {
            console.error("Data Collection section #data not found");
            alert("Data Collection page not found.");
            return;
        }

        dataPage.classList.add("active-page");

        // ⭐ Highlight DATA COLLECTION in sidebar
        const dataNav =
            document.querySelector(
                '.nav-item[data-page="data"]'
            );

        if (dataNav) {
            dataNav.classList.add("active");
        }

        // Scroll to top
        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

    });

});
// ======================================================
// START ASSESSMENT -> DATA COLLECTION
// ======================================================

document.addEventListener("DOMContentLoaded", function () {

    const startAssessmentBtn =
        document.getElementById("startAssessmentBtn");

    if (!startAssessmentBtn) {
        console.error("Start Assessment button not found");
        return;
    }

    startAssessmentBtn.addEventListener("click", function () {

        console.log("START ASSESSMENT CLICKED");

        // -----------------------------------------------
        // 1. Show Data Collection
        // -----------------------------------------------

        const pages =
            document.querySelectorAll(".page");

        pages.forEach(function (page) {
            page.classList.remove("active-page");
        });

        const dataPage =
            document.getElementById("data");

        if (!dataPage) {
            console.error("Data Collection page not found");
            return;
        }

        dataPage.classList.add("active-page");


        // -----------------------------------------------
        // 2. REMOVE Dashboard highlight
        // -----------------------------------------------

        const navItems =
            document.querySelectorAll(".nav-item");

        navItems.forEach(function (nav) {
            nav.classList.remove("active");
        });


        // -----------------------------------------------
        // 3. ADD highlight to Data Collection
        // -----------------------------------------------

        const dataNav =
            document.querySelector(
                '.nav-item[data-page="data"]'
            );

        if (dataNav) {

            dataNav.classList.add("active");

            console.log(
                "DATA COLLECTION HIGHLIGHTED"
            );

        } else {

            console.error(
                "Data Collection sidebar button not found"
            );

        }

    });

});


// ======================================================
// CONTINUOUS MONITORING (Start / Stop)
// ======================================================
// USER-SHARED PHONE DATA
// ======================================================

(function setupPhoneData() {

    function csrfToken() {
        const m = document.querySelector(
            'meta[name="csrf-token"]'
        );
        return m ? m.content : "";
    }

    if (state) {
        state.healthSynced = false;
        state.consent = state.consent || {};
    }

    const chatFile =
        document.getElementById("chatFile");
    const chatFileName =
        document.getElementById("chatFileName");
    const usage =
        document.getElementById("usageConsent");
    const notif =
        document.getElementById("notificationConsent");
    const health =
        document.getElementById("healthConsent");
    const usageStatus =
        document.getElementById("usageStatus");
    const notifStatus =
        document.getElementById("notificationStatus");
    const healthStatus =
        document.getElementById("healthStatus");
    const healthSync =
        document.getElementById("healthSync");
    const saveHealthBtn =
        document.getElementById("saveHealthBtn");
    const hrInput = document.getElementById("hrInput");
    const sleepInput = document.getElementById("sleepInput");
    const stepsInput = document.getElementById("stepsInput");
    const healthSyncStatus =
        document.getElementById("healthSyncStatus");

    function setStatus(el, on) {
        if (!el) return;
        el.textContent = on ? "Connected" : "Not connected";
        el.classList.toggle("on", !!on);
    }

    // ---- Real consent enforcement -------------------------------
    function loadConsent() {
        fetch("/get-consent", {
            headers: { "X-CSRFToken": csrfToken() }
        })
            .then(r => r.json())
            .then(d => {
                if (d && d.success && d.consent) {
                    if (state) state.consent = d.consent;
                }
            })
            .catch(() => {});
    }
    window.loadConsent = loadConsent;

    function consentAllows(id) {
        const c = (state && state.consent) || {};
        if (id === "usageConsent") return !!c.app_usage;
        if (id === "notificationConsent") return !!c.notifications;
        if (id === "healthConsent") return !!c.health_data;
        return true;
    }

    // ---- App Usage: real in-browser telemetry ------------------
    let usageTimer = null;
    let usageActive = 0;
    let usageIdle = 0;
    let usageInteractions = 0;
    let lastActivity = 0;
    let usageOnAct = null;

    function startUsage() {
        if (usageTimer) return;
        usageActive = 0;
        usageIdle = 0;
        usageInteractions = 0;
        lastActivity = Date.now();
        usageOnAct = function () {
            usageInteractions++;
            lastActivity = Date.now();
        };
        document.addEventListener("mousemove", usageOnAct);
        document.addEventListener("keydown", usageOnAct);
        document.addEventListener("click", usageOnAct);
        usageTimer = setInterval(function () {
            if ((Date.now() - lastActivity) > 2000) {
                usageIdle += 2;
            } else {
                usageActive += 2;
            }
        }, 2000);
    }

    function stopUsage() {
        if (!usageTimer) return;
        clearInterval(usageTimer);
        usageTimer = null;
        if (usageOnAct) {
            document.removeEventListener("mousemove", usageOnAct);
            document.removeEventListener("keydown", usageOnAct);
            document.removeEventListener("click", usageOnAct);
        }
        fetch("/log-usage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                active_seconds: Math.round(usageActive),
                idle_seconds: Math.round(usageIdle),
                interactions: usageInteractions
            })
        }).catch(() => {});
    }

    // ---- Notifications: real browser notifications -------------
    let notifTimer = null;
    let notifMode = "off";

    function showInAppReminder(title, body) {
        try {
            var b = document.createElement("div");
            b.className = "inapp-notif";
            b.innerHTML =
                "<b>" + title + "</b><span>" + body + "</span>" +
                '<button type="button" class="inapp-close" aria-label="Close">\u00d7</button>';
            document.body.appendChild(b);
            var close = b.querySelector(".inapp-close");
            if (close) {
                close.addEventListener("click", function () {
                    if (b.parentNode) b.parentNode.removeChild(b);
                });
            }
            setTimeout(function () {
                if (b.parentNode) b.parentNode.removeChild(b);
            }, 8000);
        } catch (e) {}
    }

    function startInAppMode() {
        notifMode = "inapp";
        showInAppReminder("MindWatch connected",
            "Check-in notifications enabled (in-app mode).");
        if (notifTimer) clearInterval(notifTimer);
        notifTimer = setInterval(function () {
            showInAppReminder("MindWatch check-in",
                "How are you feeling right now?");
        }, 120000);
        if (notif) notif.checked = true;
        refreshSources();
    }

    function startNotif() {
        if (!("Notification" in window)) {
            startInAppMode();
            return;
        }
        function applyPerm(perm) {
            if (perm === "granted") {
                notifMode = "real";
                if (notif) notif.checked = true;
                try {
                    new Notification("MindWatch connected", {
                        body: "Check-in notifications are now enabled."
                    });
                } catch (e) {}
                if (notifTimer) clearInterval(notifTimer);
                notifTimer = setInterval(function () {
                    try {
                        new Notification("MindWatch check-in", {
                            body: "How are you feeling right now?"
                        });
                    } catch (e) {}
                }, 120000);
            } else {
                startInAppMode();
            }
            refreshSources();
        }
        if (Notification.permission === "granted") {
            applyPerm("granted");
        } else if (Notification.permission === "denied") {
            startInAppMode();
        } else if (Notification.requestPermission) {
            var req = Notification.requestPermission();
            if (req && typeof req.then === "function") {
                req.then(applyPerm);
            } else {
                req(applyPerm);
            }
        } else {
            applyPerm(Notification.permission);
        }
    }

    function stopNotif() {
        if (notifTimer) {
            clearInterval(notifTimer);
            notifTimer = null;
        }
        notifMode = "off";
    }

    // ---- Health: manual sync of real wearable numbers ---------
    function loadHealth() {
        fetch("/get-health", {
            headers: { "X-CSRFToken": csrfToken() }
        })
            .then(r => r.json())
            .then(d => {
                if (d && d.success && d.health) {
                    window.__healthSteps =
                        Number(d.health.steps) || 0;
                    if (hrInput && d.health.heart_rate != null) {
                        hrInput.value = d.health.heart_rate;
                    }
                    if (sleepInput && d.health.sleep_hours != null) {
                        sleepInput.value = d.health.sleep_hours;
                    }
                    if (stepsInput && d.health.steps != null) {
                        stepsInput.value = d.health.steps;
                    }
                }
            })
            .catch(() => {});
    }

    // ---- Monitoring: bring the latest session into the report ----
    function refreshSources() {
        let n = 0;
        const u = !!(usage && usage.checked);
        const nf = !!(notif && notif.checked);
        const h = !!(state && state.healthSynced);
        if (u) n++;
        if (nf) n++;
        if (h) n++;
        if (window.nlpChatRisk) n++;
        if (state) state.phoneSources = n;
        const sv = document.getElementById("sourceValue");
        if (sv) {
            sv.textContent =
                (Number(state && state.sources) || 0)
                + n + "/4";
        }
        setStatus(usageStatus, u);
        if (notifStatus) {
            notifStatus.textContent =
                (nf && notifMode === "inapp") ? "Connected (in-app)" :
                (nf ? "Connected" : "Not connected");
            notifStatus.classList.toggle("on", !!nf);
        } else {
            setStatus(notifStatus, nf);
        }
        setStatus(healthStatus, h);
    }

    if (chatFile) {
        chatFile.addEventListener("change", function () {
            const c = (state && state.consent) || {};
            if (!c.shared_chat) {
                alert("Consent required: please enable " +
                      "'Shared chat' in Privacy & Consent first.");
                this.value = "";
                if (chatFileName) {
                    chatFileName.textContent =
                        "No chat file selected";
                }
                if (window.showPage) showPage("dashboard");
                return;
            }
            const file = chatFile.files && chatFile.files[0];
            if (!file) return;
            if (chatFileName) {
                chatFileName.textContent = file.name;
            }
            const reader = new FileReader();
            reader.onload = function (e) {
                const text = String(e.target.result || "");
                fetch("/analyze-nlp", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": csrfToken()
                    },
                    body: JSON.stringify({ text: text })
                })
                    .then(r => r.json())
                    .then(res => {
                        if (res.success) {
                            window.nlpChatRisk =
                                Number(res.text_risk) || 0;
                            refreshSources();
                            if (chatFileName) {
                                chatFileName.textContent =
                                    file.name + " — analyzed";
                            }
                        }
                    })
                    .catch(() => {});
            };
            reader.readAsText(file);
        });
    }

    if (saveHealthBtn) {
        saveHealthBtn.addEventListener("click", function () {
            const payload = {
                heart_rate: (hrInput && hrInput.value !== "")
                    ? hrInput.value : null,
                sleep_hours: (sleepInput && sleepInput.value !== "")
                    ? sleepInput.value : null,
                steps: (stepsInput && stepsInput.value !== "")
                    ? stepsInput.value : null
            };
            if (payload.heart_rate === null &&
                payload.sleep_hours === null &&
                payload.steps === null) {
                if (healthSyncStatus) {
                    healthSyncStatus.textContent =
                        "Enter at least one real value.";
                }
                return;
            }
            fetch("/save-health", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            })
                .then(r => r.json())
                .then(d => {
                    if (healthSyncStatus) {
                        healthSyncStatus.textContent = d.success
                            ? "✓ Real health data synced."
                            : "✗ " + (d.message || "Could not save.");
                    }
                    if (d.success && state) {
                        state.healthSynced = true;
                        refreshSources();
                    }
                })
                .catch(() => {
                    if (healthSyncStatus) {
                        healthSyncStatus.textContent =
                            "✗ Network error.";
                    }
                });
        });
    }

    [usage, notif, health].forEach(function (el) {
        if (!el) return;
        el.addEventListener("change", function () {
            if (this.checked && !consentAllows(this.id)) {
                this.checked = false;
                alert("Consent required: please enable this " +
                      "category in Privacy & Consent first.");
                if (window.showPage) showPage("dashboard");
                refreshSources();
                return;
            }
            if (this.id === "usageConsent") {
                this.checked ? startUsage() : stopUsage();
            }
            if (this.id === "notificationConsent") {
                this.checked ? startNotif() : stopNotif();
            }
            if (this.id === "healthConsent") {
                if (this.checked) {
                    if (healthSync) healthSync.style.display = "block";
                } else {
                    if (healthSync) healthSync.style.display = "none";
                    if (state) state.healthSynced = false;
                }
            }
            refreshSources();
        });
    });

    loadConsent();
    loadHealth();
    refreshSources();

})();

// ======================================================

(function setupMonitoring() {

    const startBtn =
        document.getElementById("startMonitorBtn");

    const stopBtn =
        document.getElementById("stopMonitorBtn");

    const consent =
        document.getElementById("monitorConsent");

    const statusPill =
        document.getElementById("monitorStatus");

    const sessionTimeEl =
        document.getElementById("sessionTime");

    const interactionEl =
        document.getElementById("interactionCount");

    const textChangesEl =
        document.getElementById("textChanges");

    const liveActivityEl =
        document.getElementById("liveActivity");

    const textWordsEl =
        document.getElementById("textWordsLive");

    const lastUpdateEl =
        document.getElementById("lastUpdate");

    const lastEventEl =
        document.getElementById("lastEvent");


    if (!startBtn || !stopBtn) {
        return;
    }


    let monitorTimer = null;
    let tick = 0;


    function formatTime(totalSeconds) {

        const minutes =
            String(Math.floor(totalSeconds / 60))
                .padStart(2, "0");

        const seconds =
            String(totalSeconds % 60)
                .padStart(2, "0");

        return minutes + ":" + seconds;
    }


    function setLiveActivity(value, active) {

        if (!liveActivityEl) {
            return;
        }

        liveActivityEl.textContent = value;
        liveActivityEl.classList.toggle("active", !!active);
        liveActivityEl.classList.toggle("idle", !active);
    }


    function startMonitoring() {

        console.log("START MONITORING CLICKED");

        if (!consent || !consent.checked) {

            alert(
                "Please enable the monitoring consent " +
                "checkbox before starting."
            );

            return;
        }

        if (state.monitoring) {
            return;
        }

        state.monitoring = true;
        state.monitorStartedAt = Date.now();
        state.interactionCount = 0;
        state.textChanges = 0;
        state.lastInteractionAt = Date.now();
        state.activeTicks = 0;
        state.idleTicks = 0;
        state.peakWords = 0;
        tick = 0;

        // Reflect the latest real wellness score on the gauge
        const gv = document.getElementById("gaugeValue");
        if (gv && state.score !== undefined && state.score !== null) {
            gv.textContent = Math.round(state.score);
        }

        // Plot real assessment history instead of fake data
        renderMonitorHistory();

        if (statusPill) {
            statusPill.textContent = "● Monitoring Active";
        }

        startBtn.disabled = true;
        stopBtn.disabled = false;

        if (lastEventEl) {
            lastEventEl.textContent = "Monitoring started";
        }

        monitorTimer = setInterval(function () {

            tick++;

            const elapsed =
                Math.floor(
                    (Date.now() - state.monitorStartedAt) / 1000
                );

            if (sessionTimeEl) {
                sessionTimeEl.textContent = formatTime(elapsed);
            }

            if (interactionEl) {
                interactionEl.textContent = state.interactionCount;
            }

            if (textChangesEl) {
                textChangesEl.textContent = state.textChanges;
            }

            const journal =
                document.getElementById("journal");

            if (journal && textWordsEl) {

                const words =
                    journal.value.trim()
                        ? journal.value.trim().split(/\s+/).length
                        : 0;

                textWordsEl.textContent = words;
            }

            const recent =
                (Date.now() - (state.lastInteractionAt || 0)) < 2000;

            setLiveActivity(recent ? "Active" : "Idle", recent);

            // Accumulate session metrics (used in the person's report)
            if (recent) {
                state.activeTicks = (state.activeTicks || 0) + 1;
            } else {
                state.idleTicks = (state.idleTicks || 0) + 1;
            }
            const liveWords =
                textWordsEl ? Number(textWordsEl.textContent) || 0 : 0;
            state.peakWords = Math.max(state.peakWords || 0, liveWords);

            // Keep gauge in sync with the latest real score
            const gv = document.getElementById("gaugeValue");
            if (gv && state.score !== undefined && state.score !== null) {
                gv.textContent = Math.round(state.score);
            }

            if (lastUpdateEl) {
                lastUpdateEl.textContent =
                    new Date().toLocaleTimeString();
            }

        }, 2000);

    }

    if (startBtn) {
        startBtn.addEventListener("click", startMonitoring);
    }
    // Expose so an inline onclick can also trigger it (defensive)
    window.startMonitoring = startMonitoring;


    stopBtn.addEventListener("click", function () {

        state.monitoring = false;

        if (monitorTimer) {
            clearInterval(monitorTimer);
            monitorTimer = null;
        }

        if (statusPill) {
            statusPill.textContent = "● Monitoring Paused";
        }

        startBtn.disabled = false;
        stopBtn.disabled = true;

        setLiveActivity("Idle", false);

        // ---- Save the session so it contributes to the person's report ----
        const started = state.monitorStartedAt || 0;
        const durationSec = started
            ? Math.max(0, (Date.now() - started) / 1000)
            : 0;

        const activeTicks = state.activeTicks || 0;
        const idleTicks = state.idleTicks || 0;
        const totalTicks = activeTicks + idleTicks;
        const activeRatio = totalTicks > 0 ? activeTicks / totalTicks : 0;
        const minutes = Math.max(1, durationSec / 60);
        const intPerMin = (state.interactionCount || 0) / minutes;
        const chgPerMin = (state.textChanges || 0) / minutes;

        // Monitoring risk: typing pressure + social disengagement while idle
        let monitoringRisk = 0;
        if (durationSec >= 30) {
            const typingPressure =
                chgPerMin >= 6 ? 70 :
                    chgPerMin >= 3 ? 45 :
                        chgPerMin >= 1 ? 25 : 10;
            const disengagement =
                (activeRatio < 0.35 && intPerMin < 1)
                    ? 65
                    : activeRatio < 0.55
                        ? 35
                        : 15;
            monitoringRisk = Math.round(
                typingPressure * 0.6 + disengagement * 0.4
            );
        }

        if (durationSec >= 30) {
            try {
                fetch("/monitoring-session", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        active_seconds: Math.round(activeRatio * durationSec),
                        idle_seconds: Math.round((1 - activeRatio) * durationSec),
                        interactions: state.interactionCount || 0,
                        text_changes: state.textChanges || 0,
                        peak_words: state.peakWords || 0,
                        monitoring_risk: monitoringRisk
                    })
                });
            } catch (e) { /* ignore */ }

            window.__monitorRisk = monitoringRisk;
            state.lastMonitorSummary = {
                duration: Math.round(durationSec),
                interactions: state.interactionCount || 0,
                textChanges: state.textChanges || 0,
                risk: monitoringRisk
            };
        }

        if (lastEventEl) {
            lastEventEl.textContent =
                durationSec >= 30
                    ? "Monitoring stopped — session saved (" +
                        Math.round(durationSec) + "s)"
                    : "Monitoring stopped";
        }

    });


    // Count user interactions while monitoring
    document.addEventListener("click", function () {

        if (state.monitoring) {
            state.interactionCount++;
            state.lastInteractionAt = Date.now();
        }

    });


    async function renderMonitorHistory() {

        try {

            const res = await fetch(
                "/assessment-history",
                { cache: "no-store" }
            );

            const result = await res.json();

            if (!result.success || !result.assessments) {
                return;
            }

            const list =
                result.assessments.slice().reverse();

            const labels = list.map(function (a) {
                return (a.created_at || "").split(",")[0] || "—";
            });

            const data = list.map(function (a) {
                return Number(a.wellness_score);
            });

            // Reflect the latest saved score on the gauge (works even
            // before the user runs a new screening this session)
            if (list.length) {
                state.score = Number(list[list.length - 1].wellness_score);
                const gv = document.getElementById("gaugeValue");
                if (gv && state.score !== undefined && state.score !== null) {
                    gv.textContent = Math.round(state.score);
                }
            }

            if (monitorChart && labels.length) {
                monitorChart.data.labels = labels;
                monitorChart.data.datasets[0].data = data;
                monitorChart.update();
            } else if (labels.length) {
                // Fallback: draw simple bars when Chart.js is unavailable
                const fb =
                    document.getElementById("monitorChartFallback");
                const canvas =
                    document.getElementById("monitorChart");
                if (fb) {
                    if (canvas) canvas.style.display = "none";
                    fb.style.display = "flex";
                    const max = Math.max.apply(null, data.concat([1]));
                    fb.innerHTML = list.map(function (a, i) {
                        const v = Number(a.wellness_score);
                        const h = Math.max(4, Math.round((v / max) * 100));
                        return "<div class='mbar' style='height:" +
                            h + "%'><span>" + labels[i] +
                            "<br>" + v + "</span></div>";
                    }).join("");
                }
            }

        } catch (e) { /* ignore */ }

    }

    // Also refresh the chart on load (not only when monitoring starts)
    renderMonitorHistory();

})();


// ======================================================
// RISK ALERTS + DAILY REMINDERS
// ======================================================

(function setupAlertsAndReminders() {

    const ALERT_SEEN = "mw_alert_seen";
    const REMIND_KEY = "mw_remind";

    // Called by updateUI / seedDashboard / showPage whenever risk changes.
    window.__updateRiskAlertUI = function (risk) {
        window.__latestRisk = typeof risk === "number" ? risk : NaN;
        renderAlerts();
    };


    function renderAlerts() {

        const pill = document.getElementById("riskAlertPill");
        const body = document.getElementById("riskAlertBody");

        if (!body) { return; }

        const hasScore =
            typeof window.__latestRisk === "number" &&
            !isNaN(window.__latestRisk);

        if (!hasScore) {
            if (pill) {
                pill.textContent = "● No active alerts";
                pill.classList.remove("pill-danger", "pill-ok");
            }
            body.innerHTML =
                "<div class='muted'>Complete an assessment to see your " +
                "risk status here.</div>";
            return;
        }

        const risk = Math.max(0, Math.min(100, window.__latestRisk));
        const high = risk >= 60;
        const seen =
            localStorage.getItem(ALERT_SEEN) === String(Math.round(risk));

        if (pill) {
            pill.textContent =
                high ? "● High risk alert" : "● No active alerts";
            pill.classList.toggle("pill-danger", high);
            pill.classList.toggle("pill-ok", !high);
        }

        const level = risk >= 80
            ? "Very high"
            : risk >= 60
                ? "High"
                : risk >= 30
                    ? "Moderate"
                    : "Low";

        body.innerHTML =
            "<div class='" + (high ? "risk-alert-on" : "risk-alert-off") + "'>" +
                "<p><b>" + (high ? level + " risk detected" : "No active alerts") +
                "</b> — latest score " + Math.round(100 - risk) + " / 100.</p>" +
                (high
                    ? "<p>You are not alone. Please talk to someone you trust, " +
                      "your counsellor, or a support line. Reach out - support " +
                      "helps.</p>"
                    : "<p>Keep up your routine - consistent sleep, activity, and " +
                      "screen breaks help keep your wellness steady.</p>") +
            "</div>" +
            (high && !seen
                ? "<button type='button' class='outline-btn' " +
                  "id='markAlertSeen'>Mark as seen</button>"
                : "") +
            "<div class='muted' style='margin-top:10px'>Educational " +
            "indicator, not a diagnosis or medical advice.</div>";

        const mark = document.getElementById("markAlertSeen");
        if (mark) {
            mark.addEventListener("click", function () {
                localStorage.setItem(ALERT_SEEN, String(Math.round(risk)));
                renderAlerts();
            });
        }

        // Browser notification for a NEW high-risk result
        if (high && !seen) {
            notify(
                "High-risk wellness result",
                "Your latest assessment flagged " + level +
                " risk. Support options are available in the app."
            );
        }
    }


    function notify(title, msg) {
        try {
            if ("Notification" in window &&
                Notification.permission === "granted") {
                new Notification(title, { body: msg });
                return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    }


    // ===================== Daily reminders =====================

    const enabledEl = document.getElementById("remindEnabled");
    const timeEl = document.getElementById("remindTime");
    const statusEl = document.getElementById("remindStatus");
    const bannerEl = document.getElementById("remindBanner");
    const enableBtn = document.getElementById("remindEnableBtn");
    const testBtn = document.getElementById("remindTestBtn");

    // ===================== Web push (PWA) =====================
    function csrfToken() {
        const m = document.querySelector('meta[name="csrf-token"]');
        return m ? m.getAttribute("content") : "";
    }

    function postJSON(url, payload) {
        return fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": csrfToken()
            },
            body: JSON.stringify(payload)
        });
    }

    function urlBase64ToUint8Array(base64String) {
        const padding =
            "=".repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, "+")
            .replace(/_/g, "/");
        const raw = window.atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
            output[i] = raw.charCodeAt(i);
        }
        return output;
    }

    // Registers the service worker and saves this browser's push
    // subscription on the server. Resolves true when fully set up.
    function subscribePush() {
        if (!("serviceWorker" in navigator) ||
            !window.APP_VAPID_PUBLIC_KEY) {
            return Promise.resolve(false);
        }
        return navigator.serviceWorker.register("/sw.js")
            .then(function () {
                return navigator.serviceWorker.ready;
            })
            .then(function (reg) {
                return reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey:
                        urlBase64ToUint8Array(window.APP_VAPID_PUBLIC_KEY)
                });
            })
            .then(function (sub) {
                const json = sub.toJSON();
                return postJSON("/push/subscribe", {
                    endpoint: json.endpoint,
                    p256dh: json.keys.p256dh,
                    auth: json.keys.auth
                }).then(function () {
                    return syncPushSchedule();
                });
            })
            .then(function () {
                window.__pushReminderActive = true;
                return true;
            })
            .catch(function () {
                window.__pushReminderActive = false;
                return false;
            });
    }

    // Server needs the reminder time so it can fire the push at the
    // right moment even when the page is closed.
    function syncPushSchedule() {
        if (!window.__pushReminderActive) {
            return Promise.resolve();
        }
        return postJSON("/push/schedule", {
            enabled: !!(enabledEl && enabledEl.checked),
            time: timeEl ? timeEl.value : "20:00"
        }).catch(function () { /* ignore */ });
    }

    function loadSettings() {
        try {
            const raw = localStorage.getItem(REMIND_KEY);
            if (!raw) { return; }
            const s = JSON.parse(raw);
            if (enabledEl && s.enabled !== undefined) {
                enabledEl.checked = !!s.enabled;
            }
            if (timeEl && s.time) { timeEl.value = s.time; }
        } catch (e) { /* ignore */ }
    }

    function saveSettings() {
        try {
            localStorage.setItem(REMIND_KEY, JSON.stringify({
                enabled: enabledEl ? enabledEl.checked : false,
                time: timeEl ? timeEl.value : "20:00"
            }));
        } catch (e) { /* ignore */ }
        updateRemindStatus();
        // Tell the server the new schedule so pushes keep working closed
        setTimeout(function () { syncPushSchedule(); }, 100);
    }

    function formatTime(t) {
        if (!t) { return "--:--"; }
        const parts = t.split(":");
        const h = Number(parts[0]);
        const ampm = h >= 12 ? "PM" : "AM";
        return (h % 12 || 12) + ":" + parts[1] + " " + ampm;
    }

    function supportsNotify() {
        return "Notification" in window;
    }

    function notifyPerm() {
        return supportsNotify() ? Notification.permission : "denied";
    }

    // Asks for permission unless already decided; resolves true when granted.
    function ensureNotifyPermission() {
        if (!supportsNotify()) { return Promise.resolve(false); }
        if (notifyPerm() === "granted") { return Promise.resolve(true); }
        if (notifyPerm() === "denied") { return Promise.resolve(false); }
        try {
            return Notification.requestPermission().then(function (p) {
                return p === "granted";
            });
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function updateRemindStatus() {
        if (!statusEl) { return; }
        const on = !!(enabledEl && enabledEl.checked);
        const t = timeEl ? timeEl.value : "20:00";
        let msg;
        if (!supportsNotify()) {
            msg = "This browser does not support notifications, but " +
                  "reminders still appear inside the app.";
        } else if (notifyPerm() === "granted") {
            msg = on
                ? "Reminders on — a notification pops up daily at " +
                  formatTime(t) + "."
                : "Reminders are off. Enable them above to get a daily " +
                  "prompt at " + formatTime(t) + ".";
        } else {
            msg = on
                ? "Reminders on — allow notifications to also get a " +
                  "pop-up at " + formatTime(t) + "."
                : "Reminders are off. Enable them above to get a daily " +
                  "prompt at " + formatTime(t) + ".";
        }
        statusEl.textContent = msg;
    }

    function triggerReminder(manual) {
        const on = !!(enabledEl && enabledEl.checked);
        const t = timeEl ? timeEl.value : "20:00";
        const msg =
            "Ready for your daily check-in? A quick 2-minute assessment " +
            "helps you understand how you're feeling today.";

        if (bannerEl) {
            bannerEl.style.display = "block";
            bannerEl.textContent = manual && !on
                ? "Test reminder (reminders are off): " + msg
                : msg;
        }

        const shown = notify("MindWatch daily check-in", msg);

        if (statusEl) {
            statusEl.textContent = shown
                ? "Reminder sent " + new Date().toLocaleTimeString() +
                  ". Next scheduled: " + formatTime(t) + "."
                : "Reminder appeared in the app, but the browser " +
                  "notification was blocked or not allowed.";
        }
    }

    function scheduleCheck() {
        // When web push is set up, the server delivers the reminder even
        // if this page is closed - don't double-fire here.
        if (window.__pushReminderActive) { return; }
        if (!enabledEl || !enabledEl.checked) { return; }
        const t = timeEl ? timeEl.value : "";
        if (!t) { return; }

        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const todayKey = now.toDateString();

        if (hh + ":" + mm === t &&
            localStorage.getItem("mw_remind_sent") !== todayKey) {
            localStorage.setItem("mw_remind_sent", todayKey);
            triggerReminder(false);
        }
    }

    loadSettings();
    updateRemindStatus();

    if (enabledEl) {
        enabledEl.addEventListener("change", function () {
            if (enabledEl.checked) {
                // Turning reminders on also asks for notification permission
                ensureNotifyPermission().then(function (granted) {
                    if (granted) {
                        return subscribePush();
                    }
                    return Promise.resolve(false);
                }).then(function () {
                    saveSettings();
                    if (window.__pushReminderActive) {
                        updateRemindStatus();
                    }
                });
            } else {
                saveSettings();
            }
        });
    }
    if (timeEl) {
        timeEl.addEventListener("change", saveSettings);
    }
    if (enableBtn) {
        enableBtn.addEventListener("click", function () {
            ensureNotifyPermission().then(function (granted) {
                if (!granted) {
                    if (statusEl) {
                        statusEl.textContent =
                            "Notifications blocked — reminders will still " +
                            "appear inside the app.";
                    }
                    return;
                }
                return subscribePush().then(function (ok) {
                    if (statusEl) {
                        statusEl.textContent = ok
                            ? "Notifications allowed — you will get a " +
                              "pop-up at reminder time, even when the " +
                              "app is closed."
                            : "Notifications allowed, but push is not " +
                              "available here (needs a secure " +
                              "connection or a supported browser).";
                    }
                });
            });
        });
    }
    if (testBtn) {
        testBtn.addEventListener("click", function () {
            ensureNotifyPermission().then(function () {
                triggerReminder(true);
            });
        });
    }

    // Re-attach the push subscription quietly if permission was already
    // granted in a previous visit (browser reuses the existing one).
    if (supportsNotify() && notifyPerm() === "granted") {
        subscribePush();
    }

    // Fire while the app stays open
    scheduleCheck();
    setInterval(scheduleCheck, 20000);

})();


// ======================================================
// PROFESSIONAL ONE-TO-ONE MESSAGING
// ======================================================

let _proMessageTo = "";
let _proMessageEmail = "";
let _proMessagePhone = "";


function messageProfessionalBtn(btn) {

    // Open the compose form so the user can type their OWN subject
    // and message; we just remember which professional + contact.
    const name = btn.getAttribute("data-name") || "";
    const email = (btn.getAttribute("data-email") || "").trim();
    const phone = (btn.getAttribute("data-phone") || "").trim();

    openProfessionalMessageModal(name, email, phone);

}


function openProfessionalMessageModal(toName, email, phone) {

    const modal =
        document.getElementById(
            "professionalMessageModal"
        );

    if (!modal) {
        alert("Message form is missing.");
        return;
    }

    // Remember which professional + real contact this message targets.
    // When called without args (the generic support button) these reset.
    _proMessageTo = (typeof toName === "string" && toName)
        ? toName : "";
    _proMessageEmail = (typeof email === "string" && email)
        ? email.trim() : "";
    _proMessagePhone = (typeof phone === "string" && phone)
        ? phone.trim() : "";

    const toEl = document.getElementById("proTo");
    if (toEl) {
        toEl.textContent = _proMessageTo
            ? ("📨 To: " + _proMessageTo)
            : "📨 To: Any available professional";
    }

    const status =
        document.getElementById("proMessageStatus");

    if (status) {
        status.textContent = "";
    }

    modal.style.display = "flex";
    loadMyProfessionalMessages();
}


function closeProfessionalMessageModal() {

    const modal =
        document.getElementById(
            "professionalMessageModal"
        );

    if (modal) {
        modal.style.display = "none";
    }
}


async function sendProfessionalMessage() {

    const subjectEl =
        document.getElementById("proSubject");

    const messageEl =
        document.getElementById("proMessage");

    const statusEl =
        document.getElementById("proMessageStatus");

    if (!subjectEl || !messageEl) {
        alert("Message form is missing.");
        return;
    }

    const subject = subjectEl.value.trim();
    const message = messageEl.value.trim();

    if (!subject || !message) {
        if (statusEl) {
            statusEl.textContent =
                "Please enter both a subject and a message.";
            statusEl.style.color = "#c03939";
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = "Sending...";
        statusEl.style.color = "#64748b";
    }

    // If we have the professional's real contact, deliver the ORIGINAL
    // composed message directly to them (via the user's own mail/phone
    // app) and keep a copy in "My Messages".
    if (_proMessageEmail) {

        window.location.href =
            "mailto:" + _proMessageEmail +
            "?subject=" + encodeURIComponent(subject) +
            "&body=" + encodeURIComponent(message);

        fetch("/send-professional-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                subject: subject,
                message: message,
                professional: _proMessageTo
            })
        }).catch(function() {});

        if (statusEl) {
            statusEl.textContent =
                "✓ Opening your email app to send to " +
                _proMessageTo + "...";
            statusEl.style.color = "#16804d";
        }

        subjectEl.value = "";
        messageEl.value = "";

        setTimeout(closeProfessionalMessageModal, 1800);
        return;

    }

    if (_proMessagePhone) {

        window.location.href =
            "tel:" + _proMessagePhone.replace(/[^0-9+]/g, "");

        fetch("/send-professional-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                subject: subject,
                message: message,
                professional: _proMessageTo
            })
        }).catch(function() {});

        if (statusEl) {
            statusEl.textContent =
                "✓ Calling " + _proMessageTo + "...";
            statusEl.style.color = "#16804d";
        }

        subjectEl.value = "";
        messageEl.value = "";

        setTimeout(closeProfessionalMessageModal, 1800);
        return;

    }

    try {

        const response = await fetch(
            "/send-professional-message",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    subject: subject,
                    message: message,
                    professional: _proMessageTo
                })
            }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(
                result.message || "Failed to send message."
            );
        }

        if (statusEl) {
            statusEl.textContent =
                "✓ " + result.message;
            statusEl.style.color = "#16804d";
        }

        subjectEl.value = "";
        messageEl.value = "";

        setTimeout(
            closeProfessionalMessageModal,
            1500
        );

    } catch (error) {

        if (statusEl) {
            statusEl.textContent =
                "❌ " + error.message;
            statusEl.style.color = "#c03939";
        }

    }
}


window.openProfessionalMessageModal =
    openProfessionalMessageModal;

window.closeProfessionalMessageModal =
    closeProfessionalMessageModal;

window.sendProfessionalMessage =
    sendProfessionalMessage;


let feedbackRating = 0;


function openFeedbackModal() {

    feedbackRating = 0;

    const modal =
        document.getElementById("feedbackModal");

    if (!modal) {
        alert("Feedback form is missing.");
        return;
    }

    modal.style.display = "flex";

    const stars = document.querySelectorAll(
        "#fbStars .fb-star"
    );

    stars.forEach(function (s) {
        s.classList.remove("active");
        s.textContent = "☆";
    });

    const area = document.getElementById("fbMessage");
    if (area) area.value = "";

    const status = document.getElementById("fbStatus");
    if (status) {
        status.textContent = "";
        status.style.color = "";
    }

}


function closeFeedbackModal() {

    const modal =
        document.getElementById("feedbackModal");

    if (modal) modal.style.display = "none";

}


function setFeedbackRating(value) {

    feedbackRating = value;

    const stars = document.querySelectorAll(
        "#fbStars .fb-star"
    );

    stars.forEach(function (s) {

        const on = Number(s.getAttribute("data-value")) <= value;

        s.classList.toggle("active", on);
        s.textContent = on ? "★" : "☆";

    });

}


function initFeedbackModal() {

    const stars = document.querySelectorAll(
        "#fbStars .fb-star"
    );

    stars.forEach(function (s) {

        s.setAttribute("type", "button");

        s.addEventListener("click", function () {

            setFeedbackRating(
                Number(s.getAttribute("data-value"))
            );

        });

    });

}


if (document.readyState === "loading") {

    document.addEventListener(
        "DOMContentLoaded", initFeedbackModal
    );

} else {

    initFeedbackModal();

}


async function submitFeedback() {

    const message = document.getElementById("fbMessage");
    const statusEl = document.getElementById("fbStatus");

    if (statusEl) {
        statusEl.textContent = "";
        statusEl.style.color = "";
    }

    if (feedbackRating < 1) {

        if (statusEl) {
            statusEl.textContent = "❌ Please pick a rating first.";
            statusEl.style.color = "#c03939";
        }
        return;

    }

    const text = (message ? message.value : "").trim();

    if (!text) {

        if (statusEl) {
            statusEl.textContent =
                "❌ Please write a short feedback message.";
            statusEl.style.color = "#c03939";
        }
        return;

    }

    try {

        const meta = document.querySelector(
            'meta[name="csrf-token"]'
        );
        const token = meta
            ? meta.getAttribute("content")
            : "";

        const response = await fetch("/api/feedback", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": token
            },
            body: JSON.stringify({
                rating: feedbackRating,
                message: text
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "Could not save your feedback."
            );
        }

        if (statusEl) {
            statusEl.textContent = "✓ " + data.message;
            statusEl.style.color = "#16804d";
        }

        setTimeout(closeFeedbackModal, 1500);
        loadMyFeedback();

    } catch (error) {

        if (statusEl) {
            statusEl.textContent = "❌ " + error.message;
            statusEl.style.color = "#c03939";
        }

    }
}


window.openFeedbackModal =
    openFeedbackModal;

window.closeFeedbackModal =
    closeFeedbackModal;

window.submitFeedback =
    submitFeedback;


function loadMyFeedback() {

    const box = document.getElementById("myFeedback");
    if (!box) return;

    box.innerHTML =
        '<div class="pro-loading">Loading your feedback...</div>';

    fetch("/api/my-feedback", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (data) {

            if (!data.success || !data.feedback ||
                data.feedback.length === 0) {

                box.innerHTML =
                    '<div class="pro-empty">No feedback yet. ' +
                    'Use "Send Feedback" to share your thoughts.</div>';
                return;

            }

            box.innerHTML = data.feedback.map(function (f) {

                const stars = "★".repeat(f.rating) +
                              "☆".repeat(5 - f.rating);

                return `
                    <div class="pro-msg">
                        <div class="pro-msg-head">
                            <b>${escapeHtml(f.message)}</b>
                            <span class="pro-msg-date">${f.created_at}</span>
                        </div>
                        <div style="font-size:16px;margin-top:4px;">${stars}</div>
                    </div>`;

            }).join("");

        })
        .catch(function () {

            box.innerHTML =
                '<div class="pro-empty">Could not load your feedback.</div>';

        });
}


window.loadMyFeedback =
    loadMyFeedback;


function loadMyProfessionalMessages() {

    const box = document.getElementById("myMessages");
    if (!box) return;

    box.innerHTML =
        '<div class="pro-loading">Loading your messages...</div>';

    fetch("/api/my-professional-messages", { cache: "no-store" })
        .then(function(r) { return r.json(); })
        .then(function(data) {

            if (!data.success || !data.messages ||
                data.messages.length === 0) {

                box.innerHTML =
                    '<div class="pro-empty">No messages sent yet. ' +
                    'Use "Message a Professional" to request a session.</div>';
                return;

            }

            box.innerHTML = data.messages.map(function(m) {
                const status = m.replied
                    ? '<span class="pro-reply yes">✓ Replied</span>'
                    : '<span class="pro-reply no">● Awaiting reply</span>';
                return `
                    <div class="pro-msg">
                        <div class="pro-msg-head">
                            <b>${escapeHtml(m.professional)}</b>
                            <span class="pro-msg-date">${m.created_at}</span>
                        </div>
                        <div class="pro-msg-sub">${escapeHtml(m.subject)}</div>
                        <div class="pro-msg-body">${escapeHtml(m.message)}</div>
                        <div class="pro-msg-status">${status}</div>
                    </div>
                `;
            }).join("");

        })
        .catch(function() {
            box.innerHTML =
                '<div class="pro-error">Could not load messages.</div>';
        });

}


window.loadMyProfessionalMessages =
    loadMyProfessionalMessages;


// Build a fully self-contained, professionally styled HTML report
// (inline styles) so printing never depends on the page's print CSS
function buildReportHTML(seed) {

    var s = Number(seed.wellness_score) || 0;
    var bd = seed.risk_breakdown;
    if (typeof bd === "string") {
        try { bd = JSON.parse(bd); } catch (e) { bd = {}; }
    }
    if (!bd || typeof bd !== "object") bd = {};

    var risk = 100 - s;

    function levelInfo(r) {
        if (r < 30) return { label: "Low", color: "#2e9e5b" };
        if (r < 60) return { label: "Moderate", color: "#d9a31a" };
        if (r < 80) return { label: "High", color: "#e07b39" };
        return { label: "Very High", color: "#d64545" };
    }

    var li = levelInfo(risk);

    function bar(label, val) {
        var pct = Math.max(0, Math.min(100, Number(val) || 0));
        var col = pct < 30 ? "#2e9e5b" :
                  pct < 60 ? "#d9a31a" :
                  pct < 80 ? "#e07b39" : "#d64545";
        var lvl = pct < 30 ? "Low" :
                  pct < 60 ? "Moderate" :
                  pct < 80 ? "High" : "Very High";
        return '<div class="bar">' +
            '<div class="bar-top"><span>' + label + '</span>' +
            '<span class="bar-right"><em class="lvl" style="background:' +
            col + '">' + lvl + '</em><b>' + pct + '%</b></span></div>' +
            '<div class="bar-track"><div class="bar-fill" style="width:' +
            pct + '%;background:' + col + '"></div></div></div>';
    }

    var rec;
    if (risk >= 60) {
        rec = "Your indicators suggest elevated stress. We recommend " +
              "speaking with a counsellor or a trusted person soon, and " +
              "exploring the Care &amp; Support resources in the app.";
    } else if (risk >= 30) {
        rec = "Some indicators are slightly elevated. Maintaining a " +
              "consistent routine, adequate sleep, and mindful breaks from " +
              "screens will help keep your wellness steady.";
    } else {
        rec = "Your wellness indicators look balanced. Keep up regular " +
              "sleep, activity, and screen breaks, and reach out for " +
              "support whenever you need it.";
    }

    var name = seed.user_name || "User";

    var riskClamped = Math.max(2, Math.min(98, risk));

    // ----- Data sources used (core + whatever the user supplied) -------
    var srcs = [];
    if (Array.isArray(bd.sources) && bd.sources.length) {
        srcs = bd.sources.slice();
    } else {
        srcs.push("Questionnaire", "Sleep", "Activity", "Screen time",
                  "Stress", "Journal text", "Social interactions");
        if (Number(bd.heartRateRisk) > 0) srcs.push("Wearable heart rate");
        if (Number(bd.stepsRisk) > 0) srcs.push("Wearable steps");
        if (Number(bd.chatRisk) > 0) srcs.push("Chat-export sentiment");
    }

    var allSrcs = ["Questionnaire", "Sleep", "Activity", "Screen time",
                   "Stress", "Journal text", "Social interactions",
                   "Wearable heart rate", "Wearable steps",
                   "Chat-export sentiment"];

    function chip(name) {
        var ok = srcs.indexOf(name) !== -1;
        return '<span class="chip ' + (ok ? "ok" : "miss") + '">' +
            '<i>' + (ok ? "\u2713" : "\u2013") + '</i>' +
            name + '</span>';
    }

    var present = 0;
    for (var ci = 0; ci < allSrcs.length; ci++) {
        if (srcs.indexOf(allSrcs[ci]) !== -1) present++;
    }

    var cov = Math.round((present / allSrcs.length) * 100);
    var sourcesHtml =
        '<div class="sources"><div style="font-size:12px;font-weight:700;' +
        'color:#1f2d4d;">Data sources used in this score</div>' +
        '<div class="chips">';
    for (var sj = 0; sj < allSrcs.length; sj++) {
        sourcesHtml += chip(allSrcs[sj]);
    }
    sourcesHtml += '</div>' +
        '<div class="cov-note">Score computed from <b>' + present +
        ' of ' + allSrcs.length + '</b> available data sources ' +
        '(' + cov + '% coverage).</div>' +
        '<div class="cov-bar"><i style="width:' + cov + '%"></i></div>' +
        '</div>';

    // ----- Indicator bars (only the ones the user provided) -----------
    var barsHtml = "";
    barsHtml += bar("Self-reported (questionnaire)", bd.qPct);
    barsHtml += bar("Sleep pattern", bd.sleepRisk);
    barsHtml += bar("Physical activity", bd.activityRisk);
    barsHtml += bar("Screen time", bd.screenRisk);
    barsHtml += bar("Stress level", bd.stressRisk);
    barsHtml += bar("Journal text", bd.textRisk);
    if (Number(bd.socialRisk) > 0) {
        barsHtml += bar("Social interactions", bd.socialRisk);
    }
    if (Number(bd.heartRateRisk) > 0) {
        barsHtml += bar("Heart rate (wearable)", bd.heartRateRisk);
    }
    if (Number(bd.stepsRisk) > 0) {
        barsHtml += bar("Steps (wearable)", bd.stepsRisk);
    }
    if (Number(bd.chatRisk) > 0) {
        barsHtml += bar("Chat-export sentiment", bd.chatRisk);
    }

    return '<!doctype html><html><head><meta charset="utf-8">' +
        '<title>MindWatch Wellness Report</title><style>' +
        '@page{margin:16mm 14mm;size:A4;}' +
        '*{box-sizing:border-box;-webkit-print-color-adjust:exact;' +
        'print-color-adjust:exact;}' +
        'body{font-family:"Segoe UI",Roboto,Arial,sans-serif;' +
        'color:#1f2d4d;margin:0;line-height:1.5;-webkit-font-smoothing:antialiased;}' +
        '.brand{display:flex;align-items:center;gap:14px;' +
        'border-bottom:3px solid #2b59c3;padding-bottom:14px;margin-bottom:18px;}' +
        '.logo{width:46px;height:46px;border-radius:12px;background:' +
        'linear-gradient(135deg,#7aa2f7,#2b59c3);color:#fff;display:flex;' +
        'align-items:center;justify-content:center;font-weight:800;' +
        'font-size:22px;box-shadow:0 6px 16px rgba(43,89,195,.28);}' +
        '.brand b{display:block;font-size:24px;color:#101b34;letter-spacing:.3px;}' +
        '.brand small{display:block;font-size:12px;color:#7d8aab;' +
        'letter-spacing:1.2px;text-transform:uppercase;margin-top:3px;}' +
        '.brand small em{font-style:normal;color:#2b59c3;font-weight:700;}' +
        '.head-meta{margin-left:auto;text-align:right;font-size:12px;' +
        'color:#5b6b88;line-height:1.8;}' +
        '.head-meta span{display:block;}' +
        '.head-meta b{color:#1f2d4d;}' +
        '.hero{margin:16px 0 22px;padding:24px 28px;border-radius:18px;' +
        'background:linear-gradient(135deg,#23408f,#2b59c3 55%,#4e79f7);' +
        'color:#fff;display:flex;align-items:center;gap:40px;}' +
        '.hero .lbl{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;' +
        'opacity:.85;}' +
        '.hero .score{font-size:56px;font-weight:800;line-height:1;margin-top:6px;}' +
        '.hero .score small{font-size:18px;font-weight:500;opacity:.85;}' +
        '.risk-chip{margin-top:10px;display:inline-block;font-size:15px;' +
        'font-weight:800;padding:6px 18px;border-radius:24px;' +
        'background:#fff;}' +
        '.sources{margin:4px 0 0;padding:14px 16px;border:1px solid #dbe4f5;' +
        'border-radius:14px;background:#fbfcff;}' +
        '.sources .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}' +
        '.sources .chip{display:inline-flex;align-items:center;gap:6px;' +
        'font-size:12px;color:#33415c;background:#eef2f9;' +
        'border:1px solid #dbe4f5;border-radius:20px;padding:4px 12px;}' +
        '.sources .chip.ok{background:#e9f6ee;border-color:#bfe6cd;' +
        'color:#1e7e44;}' +
        '.sources .chip.ok i{width:14px;height:14px;border-radius:50%;' +
        'background:#2e9e5b;color:#fff;font-style:normal;font-weight:800;' +
        'font-size:10px;display:inline-flex;align-items:center;' +
        'justify-content:center;}' +
        '.sources .chip.miss{background:#f4f6fa;border-color:#e3e8f0;' +
        'color:#99a3b9;}' +
        '.sources .chip.miss i{width:14px;height:14px;border-radius:50%;' +
        'background:#c6cedd;color:#fff;font-style:normal;font-weight:800;' +
        'font-size:12px;line-height:14px;text-align:center;}' +
        '.cov-note{font-size:11px;color:#7d8aab;margin-top:10px;}' +
        '.cov-bar{height:8px;border-radius:5px;background:#eef2f8;' +
        'overflow:hidden;margin-top:6px;}' +
        '.cov-bar i{display:block;height:100%;border-radius:5px;' +
        'background:linear-gradient(90deg,#2b59c3,#4e79f7);}' +
        '.scale{margin:-4px 0 4px;padding:0 4px;}' +
        '.scale .track{position:relative;height:10px;border-radius:6px;' +
        'background:linear-gradient(90deg,#2e9e5b 0%,#ffd24a 50%,#d64545 100%);}' +
        '.scale .pin{position:absolute;top:50%;width:16px;height:16px;' +
        'border-radius:50%;background:#fff;border:3px solid #1f2d4d;' +
        'transform:translate(-50%,-50%);}' +
        '.scale .ends{display:flex;justify-content:space-between;' +
        'font-size:11px;color:#7d8aab;margin-top:6px;}' +
        '.sec-title{display:flex;align-items:center;gap:10px;' +
        'font-size:15px;font-weight:700;color:#1f2d4d;margin:26px 0 14px;}' +
        '.sec-title i{font-style:normal;font-weight:800;color:#fff;' +
        'background:#2b59c3;border-radius:7px;width:22px;height:22px;' +
        'display:inline-flex;align-items:center;justify-content:center;' +
        'font-size:12px;}' +
        '.bar{margin:12px 0;}' +
        '.bar-top{display:flex;justify-content:space-between;' +
        'font-size:13px;color:#33415c;margin-bottom:5px;}' +
        '.bar-top b{color:#1f2d4d;}' +
        '.bar-right{display:flex;align-items:center;gap:8px;}' +
        '.lvl{display:inline-block;font-size:10px;font-weight:800;' +
        'text-transform:uppercase;letter-spacing:.6px;color:#fff;' +
        'border-radius:20px;padding:2px 10px;}' +
        '.legend{display:flex;flex-wrap:wrap;gap:14px;margin:2px 0 4px;' +
        'font-size:10px;color:#7d8aab;}' +
        '.legend span{display:inline-flex;align-items:center;gap:5px;}' +
        '.legend i{width:10px;height:10px;border-radius:50%;display:inline-block;}' +
        '.bar-track{height:12px;background:#e9eef6;border-radius:7px;overflow:hidden;}' +
        '.bar-fill{border-radius:7px;height:100%;}' +
        '.rec{border:1px solid #dbe4f5;border-left:5px solid #2b59c3;' +
        'border-radius:12px;padding:16px 18px;font-size:14px;line-height:1.7;' +
        'color:#33415c;background:#f7faff;}' +
        '.footer{margin-top:32px;padding-top:12px;border-top:1px solid #e3e8f0;' +
        'display:flex;justify-content:space-between;gap:20px;font-size:11px;' +
        'color:#9aa6bf;}' +
        '@media print{.hero,.scale,.bar,.rec{break-inside:avoid;}}' +
        '</style></head><body>' +
        '<div class="brand"><div class="logo">M</div><div>' +
        '<b>MindWatch</b><small>Wellness <em>Report</em></small>' +
        '</div><div class="head-meta">' +
        '<span>Prepared for: <b>' + name + '</b></span></div></div>' +
        '<div class="hero">' +
        '<div><div class="lbl">Wellness Score</div>' +
        '<div class="score">' + s + '<small> / 100</small></div></div>' +
        '<div style="width:1px;height:64px;background:rgba(255,255,255,.3);">' +
        '</div>' +
        '<div><div class="lbl">Risk Level</div>' +
        '<span class="risk-chip" style="color:' + li.color + '">' +
        li.label + '</span></div>' +
        '</div>' +
        '<div class="scale"><div class="track"><div class="pin" ' +
        'style="left:' + riskClamped + '%"></div></div>' +
        '<div class="ends"><span>Low risk</span><span>Balanced</span>' +
        '<span>High risk</span></div></div>' +
        '<div class="sec-title"><i>1</i>Data Sources Used</div>' +
        sourcesHtml +
        '<div class="sec-title"><i>2</i>Indicator Breakdown</div>' +
        '<div class="legend"><span><i style="background:#2e9e5b"></i>Low' +
        ' risk</span>' +
        '<span><i style="background:#d9a31a"></i>Moderate</span>' +
        '<span><i style="background:#e07b39"></i>High</span>' +
        '<span><i style="background:#d64545"></i>Very High</span></div>' +
        barsHtml +
        '<div class="sec-title"><i>3</i>Recommendation</div>' +
        '<div class="rec">' + rec + '</div>' +
        '<div class="footer"><span>This report provides an educational ' +
        'wellness indicator and is not a medical diagnosis.</span>' +
        '<span>&copy; MindWatch</span></div>' +
        '</body></html>';

}

// Open a clean window with the report and print it (independent of the
// main page's print CSS, which was unreliable in some browsers)
function printWellnessReport() {

    var seed = window.__latestAssessment;

    if (!seed || seed.wellness_score === undefined ||
        seed.wellness_score === null) {
        loadLatestAssessment().catch(function (e) {
            console.error("loadLatest error:", e);
        });
        alert("No assessment data found yet. Please run an assessment first.");
        return;
    }

    var loggedName = state.userName || "";

    if (!loggedName) {
        var pb = document.querySelector(".profile b");
        loggedName =
            pb && pb.textContent ? pb.textContent.trim() : "";
    }

    if (!loggedName) loggedName = "User";
    if (!seed.user_name) seed.user_name = loggedName;

    var html = buildReportHTML(seed);
    var w = window.open("", "_blank");

    if (!w) {
        alert("Please allow pop-ups for this site to print the report.");
        return;
    }

    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(function () { w.print(); w.close(); }, 350);

}

window.printWellnessReport = printWellnessReport;
