require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error("MONGODB_URI is not set in env!");
    process.exit(1);
}

const ProjectSchema = new mongoose.Schema({
    code: String,
    name: String,
    detailed_phases: mongoose.Schema.Types.Mixed
});

const Project = mongoose.model('Project', ProjectSchema);

async function run() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("Connected to MongoDB.");
        const projects = await Project.find();
        console.log(`Found ${projects.length} projects.`);
        for (const p of projects) {
            console.log(`\nProject: ${p.name} (${p.code})`);
            const detailed = p.detailed_phases || {};
            console.log("detailed_phases['mech_assembly']:", detailed['mech_assembly']);
            console.log("detailed_phases['mech_assembly_1']:", detailed['mech_assembly_1']);
            console.log("detailed_phases['mech_assembly_2']:", detailed['mech_assembly_2']);
        }
        await mongoose.disconnect();
    } catch (err) {
        console.error(err);
    }
}

run();
