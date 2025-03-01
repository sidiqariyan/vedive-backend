const Tool = require("../models/Tool");
const User = require("../models/User");

/**
 * Fetch All Tools Accessible to the User
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
exports.getAllTools = async (req, res) => {
  try {
    const { user } = req; // Authenticated user from middleware

    // Find all tools that the user's subscription plan allows access to
    const tools = await Tool.find({
      requiredPlan: { $in: [user.subscriptionPlan, null] }, // Include tools with no required plan or matching the user's plan
      isActive: true, // Only include active tools
    });

    res.status(200).json({ tools });
  } catch (error) {
    console.error("Error fetching tools:", error);
    res.status(500).json({ error: "Failed to fetch tools" });
  }
};

/**
 * Fetch Details of a Specific Tool
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
exports.getToolById = async (req, res) => {
  try {
    const { user } = req; // Authenticated user from middleware
    const { toolId } = req.params;

    // Find the tool by ID
    const tool = await Tool.findById(toolId);
    if (!tool) {
      return res.status(404).json({ error: "Tool not found" });
    }

    // Check if the user has access to the tool
    if (
      tool.requiredPlan &&
      !tool.requiredPlan.equals(user.subscriptionPlan) // Compare ObjectIds
    ) {
      return res.status(403).json({ error: "You do not have access to this tool" });
    }

    // Check if the tool is active
    if (!tool.isActive) {
      return res.status(403).json({ error: "This tool is currently unavailable" });
    }

    res.status(200).json({ tool });
  } catch (error) {
    console.error("Error fetching tool details:", error);
    res.status(500).json({ error: "Failed to fetch tool details" });
  }
};