const { isAuthenticated } = require("./lib/auth");

exports.handler = async (event) => {
  if (!isAuthenticated(event)) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return { statusCode: 500, body: "GITHUB_TOKEN and GITHUB_REPO env vars are not set" };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, repo }),
  };
};
