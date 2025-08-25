Refine AI – Project Requirement Refinement Platform

Refine AI is an AI-powered multi-agent system designed to collaboratively refine project requirements. It uses specialized AI agents (Project Manager, Developer, Designer, Market Analyst, and Judge) to iteratively improve project specifications, identify risks, and produce a refined product description.

🚀 Features

🤖 Multi-Agent Collaboration – Agents like Project Manager, Developer, Designer, Market Analyst, and Judge collaborate to refine requirements.

📝 Requirement Refinement Rounds – Iterative refinement rounds with detailed feedback and change logs.

📊 Judge Oversight – A judge agent ensures balanced decisions and resolves conflicts among other agents.

🎨 Interactive UI – Built with React + TailwindCSS for a modern, responsive design.

📂 Database Support – Requirements, feedback, and refined results are stored in MongoDB.

📹 Demo Video Support – Ability to embed or upload demo videos directly.

🛠️ Tech Stack

Frontend: React, TailwindCSS, Lucide Icons

Backend: Node.js, Express

Database: MongoDB (Mongoose ODM)

Authentication: Google OAuth (Passport.js)

Other Tools: Vite, REST API

📦 Installation

Clone the repository

git clone https://github.com/your-username/refine-ai.git
cd refine-ai


Install dependencies

npm install


Setup environment variables
Create a .env file in the root directory:

MONGO_URI=your_mongodb_connection_string
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
PORT=3000


Run the development server

npm run dev

📖 Usage

Start the backend API and frontend client.

Create or select a project.

Add requirements → Agents refine them across multiple rounds.

View feedback, risks, and final refined product.

Export results to PDF/JSON.

Optionally, watch the demo video of the refinement process.

📸 Screenshots

(Add screenshots of your UI here for better presentation)

📹 Demo

If you have a demo video, include it:

<video width="600" controls>
  <source src="/videos/demo.mp4" type="video/mp4">
</video>

🤝 Contributing

Contributions are welcome! Please fork the repo and create a pull request with your changes.

📄 License

This project is licensed under the MIT License.
