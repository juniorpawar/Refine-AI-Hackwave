# Refine AI – Project Requirement Refinement Platform

Refine AI is an AI-powered multi-agent system designed to collaboratively refine project requirements. It uses specialized AI agents (Project Manager, Developer, Designer, Market Analyst, and Judge) to iteratively improve project specifications, identify risks, and produce a refined product description.

## 🚀 Features

- 🤖 **Multi-Agent Collaboration** – Agents like Project Manager, Developer, Designer, Market Analyst, and Judge collaborate to refine requirements.
- 📝 **Requirement Refinement Rounds** – Iterative refinement rounds with detailed feedback and change logs.
- 📊 **Judge Oversight** – A judge agent ensures balanced decisions and resolves conflicts among other agents.
- 🎨 **Interactive UI** – Built with React + TailwindCSS for a modern, responsive design.
- 📂 **Database Support** – Requirements, feedback, and refined results are stored in MongoDB.
- 📹 **Demo Video Support** – Ability to embed or upload demo videos directly.

## 🛠️ Tech Stack

- **Frontend:** React, TailwindCSS, Lucide Icons  
- **Backend:** Node.js, Express  
- **Database:** MongoDB (Mongoose ODM)  
- **Authentication:** Google OAuth (Passport.js)  
- **Other Tools:** Vite, REST API

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/your-username/refine-ai.git
cd refine-ai

# Install dependencies (frontend)
npm install

# Install dependencies (backend)
cd backend
npm install

# open two terminals and run teh following commands
# frontend 
npm run dev

# backend -> cd backend first
npm start
