// File: server.mjs
// Start: node server.mjs
// Env: GEMINI_API_KEY=your_key
// Deps: npm i express @google/generative-ai
import 'dotenv/config';  // auto-loads .env variables

import express from "express";
import bodyParser from "body-parser";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Project from './models/projectModel.js';
import slugify from 'slugify';
import connectToDb from './utils/connectToDb.js';
import passport from "passport";
import session from "express-session";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import cors from "cors";
import User from './models/userModel.js';
import mongoose from 'mongoose';

import fs from 'fs';
import path from 'path';
import { onNewProviderDiscovered } from 'web3';

const __dirname = path.resolve(); // get current directory
const filePath = path.join(__dirname, 'mockdata.json');

const rawData = fs.readFileSync(filePath, 'utf-8');
const mockdata = JSON.parse(rawData);


const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// cors setup
app.use(
    cors({
        origin: "http://localhost:5173",   // frontend URL
        credentials: true,                 // allow cookies/session
        methods: ["GET", "POST", "PUT", "DELETE"],
    })
);

app.use(express.json());

// connect to mongo db
await connectToDb(process.env.MONGO_DB_URL);

// Setup session middleware
app.use(
    session({
        secret: "your-secret-key",
        resave: false,
        saveUninitialized: true,
    })
);
app.use(passport.initialize());
app.use(passport.session());

// Serialize user
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});

// Google OAuth Strategy
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "http://localhost:3000/auth/google/callback",
        },
        async (accessToken, refreshToken, profile, done) => {
            // saves user to data base
            try {
                // check if user exists
                let user = await User.findOne({ googleId: profile.id });

                if (!user) {
                    // create new user
                    user = await User.create({
                        googleId: profile.id,
                        name: profile.displayName,
                        picture: profile.photos[0].value, // profile image from Google
                    });
                }

                return done(null, user);
            } catch (err) {
                return done(err, null);
            }
        }
    )
);

// Routes
app.get("/", (req, res) => {
    // console.log(req.user)
    return res.json({ message: `Hello from backend server running on port : ${process.env.PORT}`, current_user: req.user })
})

app.get("/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
);

app.get("/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login" }),
    (req, res) => {
        // Redirect frontend with user session
        res.redirect("http://localhost:5173/dashboard");
    }
);

app.get("/api/current_user", (req, res) => {
    // console.log(req.user)
    if (req.user) {
        res.json({ user: req.user, authenticated: true });
    } else {
        res.json({ message: "No user logged in", authenticated: false });
    }
})

app.get("/logout", (req, res) => {
    req.logout(() => {
        res.redirect("http://localhost:5173/");
    });
});


const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS || 3);
const HARD_TIME_LIMIT_MS = Number(process.env.TIME_LIMIT_MS || 120_000);
const TEMPERATURE = Number(process.env.TEMPERATURE || 0.6);

// ---------- Normalizers & helpers ----------
const defaultAgentResponse = {
    agent: "",               // agent name
    feedback: "",            // plain text
    risks: [],               // array of strings
    suggestions: [],         // array of strings
    refinedRequirement: "",  // short string
    raw: ""                  // raw model text fallback
};

const defaultJudgeResponse = {
    refinedSpec: {           // keep this an object for frontend stability
        title: "",
        summary: "",
        features: [],
        acceptanceCriteria: [],
        nonFunctional: {},
        scope: { inScope: [], outOfScope: [] },
        milestones: []
    },
    changeLog: [],           // array of strings
    risks: [],               // array of {id, description, severity, mitigation} or strings
    consensusMap: {}         // { AgentName: "approved" | "rejected" | ... }
};

function extractJsonBlock(text) {
    if (!text || typeof text !== "string") return null;
    // Try fenced JSON first
    const fenceMatch = text.match(/```(?:json\\n)?([\\s\\S]*?)```/i);
    if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
    // Fallback: first { .. last }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) return text.slice(first, last + 1);
    return null;
}

function safeParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function normalizeAgentOutput(parsed, rawText, agentName) {
    if (!parsed) {
        return { ...defaultAgentResponse, agent: agentName, feedback: (rawText || "").slice(0, 1000), raw: rawText };
    }
    return {
        agent: parsed.agent || agentName,
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : (parsed.comment || parsed.notes || ""),
        risks: Array.isArray(parsed.risks) ? parsed.risks : (parsed.risk ? [parsed.risk] : []),
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : (parsed.actions ? parsed.actions : []),
        refinedRequirement: parsed.refinedRequirement || parsed.refinedRequirementText || parsed.refined || "",
        raw: rawText
    };
}

function normalizeJudgeOutput(parsed, rawText, priorSummary = null) {
    if (!parsed) {
        // fallback: try to use rawText string as summary
        const fallbackSummary = (rawText || "").slice(0, 1000);
        return { ...defaultJudgeResponse, refinedSpec: { ...defaultJudgeResponse.refinedSpec, summary: fallbackSummary } };
    }

    // Ensure refinedSpec is an object
    let refinedSpec = {};
    if (typeof parsed.refinedSpec === "string") {
        refinedSpec = { ...defaultJudgeResponse.refinedSpec, summary: parsed.refinedSpec };
    } else if (typeof parsed.refinedSpec === "object" && parsed.refinedSpec !== null) {
        refinedSpec = {
            ...defaultJudgeResponse.refinedSpec,
            title: parsed.refinedSpec.title || defaultJudgeResponse.refinedSpec.title,
            summary: parsed.refinedSpec.summary || parsed.refinedSpec.description || "",
            features: Array.isArray(parsed.refinedSpec.features) ? parsed.refinedSpec.features : (parsed.features || []),
            acceptanceCriteria: Array.isArray(parsed.refinedSpec.acceptanceCriteria) ? parsed.refinedSpec.acceptanceCriteria : (parsed.acceptanceCriteria || []),
            nonFunctional: parsed.refinedSpec.nonFunctional || parsed.nonFunctional || defaultJudgeResponse.refinedSpec.nonFunctional,
            scope: parsed.refinedSpec.scope || parsed.scope || defaultJudgeResponse.refinedSpec.scope,
            milestones: Array.isArray(parsed.refinedSpec.milestones) ? parsed.refinedSpec.milestones : (parsed.milestones || [])
        };
    } else {
        refinedSpec = { ...defaultJudgeResponse.refinedSpec };
    }

    const changeLog = Array.isArray(parsed.changeLog) ? parsed.changeLog : (parsed.changes || []);
    const risks = Array.isArray(parsed.risks) ? parsed.risks : (parsed.riskList || []);
    const consensusMap = (parsed.consensusMap && typeof parsed.consensusMap === "object") ? parsed.consensusMap : (parsed.consensus || {});

    return { refinedSpec, changeLog, risks, consensusMap };
}


function callWithRetry(fn, { retries = 2, baseDelay = 500 } = {}) {
    return new Promise(async (resolve, reject) => {
        let lastErr;
        for (let i = 0; i <= retries; i++) {
            try {
                return resolve(await fn());
            } catch (err) {
                lastErr = err;
                if (i < retries)
                    await new Promise((r) => setTimeout(r, baseDelay * (i + 1)));
            }
        }
        reject(lastErr);
    });
}

const AGENTS = [
    {
        name: "Project Manager",
        system: `You are a seasoned Product/Project Manager. Your goal is to clarify scope, dependencies, risks, and success metrics. Use bullet points.`,
    },
    {
        name: "Designer",
        system: `You are a pragmatic Product Designer. Focus on user journeys, accessibility, and simple wireframe notes in text.`,
    },
    {
        name: "Developer",
        system: `You are a Senior Developer. Identify architecture, APIs, data model hints, edge cases, and testing strategy.`,
    },
    {
        name: "Market Analyst",
        system: `You are a Market & Competitor Analyst. Identify target segments, benchmarks, differentiators, and KPIs.`,
    },
];

const JUDGE = {
    name: "Judge",
    system: `You are the impartial Judge. Input: requirement + agents' notes. Task: (1) Resolve conflicts; (2) Produce refined requirement spec with sections; (3) Produce a change log and short risk register; (4) Track consensus. Output JSON only with {refinedSpec, changeLog, risks, consensusMap}.`,
};

function makeModel(genAI, systemInstruction) {
    return genAI.getGenerativeModel({
        model: GEMINI_MODEL,
        systemInstruction,
        generationConfig: { temperature: TEMPERATURE },
    });
}

async function runRound({ genAI, round, initialRequirement, priorSummary }) {
    const roundTag = `Round ${round}`;

    // 1) Ask each agent for a JSON response (strict schema)
    const agentResults = await Promise.all(
        AGENTS.map(async (agent) => {
            const model = makeModel(genAI, agent.system);
            const agentPrompt = (round === 1 && priorSummary !== null) ? [
                `${roundTag} — You are the ${agent.name}.`,
                `Feedback from user: """${initialRequirement}"""`,
                priorSummary ? `Prior Judge summary: ${priorSummary.refinedSpec.slice(0, 2000)}` : "",
                `REPLY ONLY in JSON (no explanation). Use exactly this schema:\n{\n  "agent": "${agent.name}",\n  "feedback": "short plain text feedback",\n  "risks": [\"risk 1\", \"risk 2\"],\n  "suggestions": [\"improvement 1\", \"improvement 2\"],\n  "refinedRequirement": "one-line refined requirement"\n}`
            ].filter(Boolean).join("\n\n") : [
                `${roundTag} — You are the ${agent.name}.`,
                `Initial requirement: """${initialRequirement}"""`,
                priorSummary ? `Prior Judge summary: ${JSON.stringify(priorSummary.refinedSpec).slice(0, 2000)}` : "",
                `REPLY ONLY in JSON (no explanation). Use exactly this schema:\n{\n  "agent": "${agent.name}",\n  "feedback": "short plain text feedback",\n  "risks": [\"risk 1\", \"risk 2\"],\n  "suggestions": [\"improvement 1\", \"improvement 2\"],\n  "refinedRequirement": "one-line refined requirement"\n}`
            ].filter(Boolean).join("\n\n")

            let raw;
            try {
                const res = await callWithRetry(() => model.generateContent(agentPrompt));
                raw = res.response.text();
            } catch (err) {
                raw = `ERROR: ${String(err?.message || err)}`;
            }

            // Parse & normalize agent response
            const jsonBlock = extractJsonBlock(raw);
            const parsed = jsonBlock ? safeParseJson(jsonBlock) : safeParseJson(raw);
            const normalized = normalizeAgentOutput(parsed, raw, agent.name);
            return normalized;
        })
    );

    // 2) Call Judge with normalized agentResults
    const judgeModel = makeModel(genAI, JUDGE.system);
    const judgePrompt = [
        `${roundTag} — Aggregate & decide.`,
        `Initial requirement: """${initialRequirement}"""`,
        priorSummary ? `Prior summary JSON: ${JSON.stringify(priorSummary).slice(0, 4000)}` : "",
        `AgentNotes (JSON array): ${JSON.stringify(agentResults).slice(0, 12000)}`,
        `REPLY ONLY in JSON using exactly this schema:\n{\n  "refinedSpec": { "title": "", "summary": "", "features": [], "acceptanceCriteria": [], "nonFunctional": {}, "scope": {"inScope": [], "outOfScope": []}, "milestones": [] },\n  "changeLog": [\"string\"],\n  "risks": [ { \"id\":\"R1\", \"description\":\"\", \"severity\":\"\", \"mitigation\":\"\" } ],\n  "consensusMap": { \"AgentName\": \"approved\" }\n}`
    ].filter(Boolean).join("\n\n");

    let judgeRaw;
    try {
        const judgeRes = await callWithRetry(() => judgeModel.generateContent(judgePrompt));
        judgeRaw = judgeRes.response.text();
    } catch (err) {
        judgeRaw = `ERROR: ${String(err?.message || err)}`;
    }

    // Parse & normalize judge output
    const judgeJsonBlock = extractJsonBlock(judgeRaw);
    const judgeParsed = judgeJsonBlock ? safeParseJson(judgeJsonBlock) : safeParseJson(judgeRaw);
    const normalizedJudge = normalizeJudgeOutput(judgeParsed, judgeRaw, priorSummary);

    return { agentNotes: agentResults, judge: normalizedJudge, rawJudge: judgeRaw };
}

app.get("/api/user_projects", async (req, res) => {
    // console.log(req.user,"User from req")
    if (!req.user) {
        return res.json({ error: "user not authenticted" })
    }
    const { _id } = req.user;

    const projects = await Project.find({
        createdBy: _id
    })
    return res.json(projects);
})

app.get("/api/get_project/:projectId", async (req, res) => {
    try {
        const { projectId } = req.params;
        // console.log("Paramssssssssssss" , projectId)

        const id = projectId.toString();

        // Validate before using it
        // if (!mongoose.Types.ObjectId.isValid(projectId)) {
        //     return res.status(400).json({ message: "Invalid project ID" });
        // }

        const projectData = await Project.findOne({_id: id}); // pass directly
        if (!projectData) {
            return res.status(404).json({ message: "No project found" });
        }

        return res.json(projectData);
    } catch (err) {
        console.error("Error fetching project:", err);
        return res.status(500).json({ error: err.message });
    }
})

app.post("/feedback", async (req, res) => {
    const { feedback, priorContext, projectId } = req.body;
    // console.log(req.user, "USERRRRRRRRRRRRRRRRRR")
    if (!feedback) return res.status(400).json({ error: "Missing requirement" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const genAI = new GoogleGenerativeAI(apiKey);
    const started = Date.now();
    let priorSummary = priorContext;
    const transcript = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        if (Date.now() - started > HARD_TIME_LIMIT_MS) break;
        const { agentNotes, judge } = await runRound({
            genAI,
            round,
            initialRequirement: feedback,
            priorSummary,
        });
        transcript.push({ round, agentNotes, judge });
        priorSummary = judge;
    }

    const feedbackStrings = transcript[transcript.length - 1].agentNotes.map(element => {
        return { agent: element.agent, feedback: element.feedback }
    })

    const riskStrings = priorSummary.risks.map(risk => {
        return risk.description;
    })

    const updatedProject = await Project.findByIdAndUpdate(
        projectId,
        {
            title: priorSummary.refinedSpec.title,
            slug: slugify(priorSummary.refinedSpec.title, { lower: true }),
            createdBy: req.user._id || null,
            requirement: requirement,
            feedback: feedbackStrings,
            judge: {
                refinedSpec: priorSummary.refinedSpec,
                changeLog: priorSummary.changeLog,
                risks: riskStrings,
                consensusMap: priorSummary.consensusMap
            }
        },
        { new: true, runValidators: true }
    )

    if (updatedProject) {
        console.log("Data updated for this project in DB successfully")
    }

    res.json({
        projectId: updatedProject._id,
        startedAt: new Date(started).toISOString(),
        rounds: transcript.length,
        model: GEMINI_MODEL,
        initialRequirement: feedback,
        final: priorSummary,
        transcript,
    });
})


app.post("/refine", async (req, res) => {
    const { requirement } = req.body;
    // console.log(req.user, "USERRRRRRRRRRRRRRRRRR")
    if (!requirement) return res.status(400).json({ error: "Missing requirement" });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    const genAI = new GoogleGenerativeAI(apiKey);
    const started = Date.now();
    let priorSummary = null;
    const transcript = [];

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        if (Date.now() - started > HARD_TIME_LIMIT_MS) break;
        const { agentNotes, judge } = await runRound({
            genAI,
            round,
            initialRequirement: requirement,
            priorSummary,
        });
        transcript.push({ round, agentNotes, judge });
        priorSummary = judge;
    }

    const feedbackStrings = transcript[transcript.length - 1].agentNotes.map(element => {
        return { agent: element.agent, feedback: element.feedback }
    })

    const riskStrings = priorSummary.risks.map(risk => {
        return risk.description;
    })

    const newProject = await Project.create({
        title: priorSummary.refinedSpec.title,
        slug: slugify(priorSummary.refinedSpec.title, { lower: true }),
        createdBy: req.user._id || null,
        requirement: requirement,
        feedback: feedbackStrings,
        judge: {
            refinedSpec: priorSummary.refinedSpec,
            changeLog: priorSummary.changeLog,
            risks: riskStrings,
            consensusMap: priorSummary.consensusMap
        }
    })

    if (newProject) {
        console.log("Data saved to DB successfully")
    }

    res.json({
        projectId: newProject._id,
        startedAt: new Date(started).toISOString(),
        rounds: transcript.length,
        model: GEMINI_MODEL,
        initialRequirement: requirement,
        final: priorSummary,
        transcript,
    });

    // res.json(mockdata);
});

app.listen(3000, () => console.log(`🚀 API running at http://localhost:${process.env.PORT}`));