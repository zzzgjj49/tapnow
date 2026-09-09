const assert = require("node:assert/strict");

const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3000";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) throw new Error(`${options.method || "GET"} ${path} returned ${response.status}: ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

async function main() {
  const project = await request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Smoke Test" }),
  });

  try {
    assert.equal(project.name, "Smoke Test");
    await request(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Smoke Test Renamed", viewport: { x: 37, y: -22, zoom: 1.35 } }),
    });
    const generator = await request(`/api/projects/${project.id}/video-nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 410, y: 180 }),
    });
    assert.equal(generator.kind, "generator");
    assert.equal(generator.generation.model, "Kling 3.0");
    assert.deepEqual(generator.generation.selectedReferenceNodeIds, []);
    const configuredGenerator = await request(`/api/nodes/${generator.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation: { prompt: "A paper boat crossing a neon river", ratio: "9:16", duration: 10, audio: false, multiShot: true } }),
    });
    assert.equal(configuredGenerator.generation.ratio, "9:16");
    assert.equal(configuredGenerator.generation.duration, 10);
    assert.equal(configuredGenerator.generation.multiShot, true);

    const referenceForm = new FormData();
    const referenceGif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    referenceForm.append("files", new Blob([referenceGif], { type: "image/gif" }), "reference.gif");
    const withReference = await request(`/api/projects/${project.id}/nodes/${generator.id}/references`, { method: "POST", body: referenceForm });
    assert.equal(withReference.generation.references.length, 1);

    const unavailableGeneration = await fetch(`${baseUrl}/api/nodes/${generator.id}/generate`, { method: "POST" });
    assert.equal(unavailableGeneration.status, 503);
    const form = new FormData();
    form.append("x", "125");
    form.append("y", "240");
    form.append("width", "280");
    form.append("height", "180");
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
    form.append("files", new Blob([gif], { type: "image/gif" }), "pixel.gif");
    const nodes = await request(`/api/projects/${project.id}/assets`, { method: "POST", body: form });
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, "image");
    assert.equal(nodes[0].x, 125);
    assert.equal(nodes[0].y, 240);

    const textNode = await request(`/api/projects/${project.id}/text-nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: 70, y: 30, content: "Opening scene: rain drifts across a quiet station." }),
    });
    assert.equal(textNode.type, "text");
    const editedTextNode = await request(`/api/nodes/${textNode.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Opening scene: warm rain drifts across a quiet station." }),
    });
    assert.match(editedTextNode.content, /warm rain/);

    const connection = await request(`/api/projects/${project.id}/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceNodeId: nodes[0].id, targetNodeId: generator.id }),
    });
    assert.equal(connection.edge.sourceNodeId, nodes[0].id);
    assert.equal(connection.edge.targetNodeId, generator.id);
    assert.equal(connection.edge.relation, "reference");
    assert.equal(connection.edge.role, null);
    assert.equal(connection.targetNode.generation.linkedReferences.length, 1);
    assert.equal(connection.targetNode.generation.linkedReferences[0].nodeId, nodes[0].id);

    const textConnection = await request(`/api/projects/${project.id}/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceNodeId: textNode.id, targetNodeId: generator.id }),
    });
    assert.equal(textConnection.targetNode.generation.linkedReferences.length, 2);
    assert.deepEqual(
      textConnection.targetNode.generation.linkedReferences.map((reference) => reference.type).sort(),
      ["image", "text"],
    );

    const withExplicitReference = await request(`/api/nodes/${generator.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generation: { selectedReferenceNodeIds: [textNode.id] } }),
    });
    assert.deepEqual(withExplicitReference.generation.selectedReferenceNodeIds, [textNode.id]);

    const cycleResponse = await fetch(`${baseUrl}/api/projects/${project.id}/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceNodeId: generator.id, targetNodeId: textNode.id }),
    });
    assert.equal(cycleResponse.status, 400);

    const saved = await request(`/api/projects/${project.id}`);
    assert.equal(saved.nodes.length, 3);
    assert.equal(saved.edges.length, 2);
    assert.equal(saved.coverUrl, nodes[0].url);
    assert.equal(saved.name, "Smoke Test Renamed");
    assert.deepEqual(saved.viewport, { x: 37, y: -22, zoom: 1.35 });
    assert.equal(saved.nodes.find((node) => node.id === generator.id).generation.prompt, "A paper boat crossing a neon river");
    assert.match(saved.nodes.find((node) => node.id === textNode.id).content, /warm rain/);
    assert.deepEqual(saved.nodes.find((node) => node.id === generator.id).generation.selectedReferenceNodeIds, [textNode.id]);

    const cloned = await request(`/api/projects/${project.id}/clone-nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodeIds: [textNode.id, generator.id], offsetX: 50, offsetY: 60 }),
    });
    assert.equal(cloned.nodes.length, 2);
    assert.equal(cloned.edges.length, 1);
    const clonedText = cloned.nodes.find((node) => node.type === "text");
    const clonedGenerator = cloned.nodes.find((node) => node.kind === "generator");
    assert.deepEqual(clonedGenerator.generation.selectedReferenceNodeIds, [clonedText.id]);

    const restored = await request(`/api/projects/${project.id}/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: saved.nodes, edges: saved.edges }),
    });
    assert.equal(restored.nodes.length, 3);
    assert.equal(restored.edges.length, 2);

    const batchMoved = await request(`/api/projects/${project.id}/nodes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nodes: [{ id: textNode.id, x: 88, y: 44 }, { id: generator.id, x: 480, y: 210 }] }),
    });
    assert.equal(batchMoved.nodes.length, 2);
    assert.equal(batchMoved.nodes.find((node) => node.id === textNode.id).x, 88);

    const moved = await request(`/api/nodes/${nodes[0].id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x: -48.5, y: 91, width: 360, height: 231.4 }),
    });
    assert.equal(moved.x, -48.5);
    assert.equal(moved.width, 360);

    await request(`/api/edges/${connection.edge.id}`, { method: "DELETE" });
    const disconnected = await request(`/api/projects/${project.id}`);
    assert.equal(disconnected.edges.length, 1);
    assert.equal(disconnected.nodes.find((node) => node.id === generator.id).generation.linkedReferences.length, 1);
    assert.equal(disconnected.nodes.find((node) => node.id === generator.id).generation.linkedReferences[0].type, "text");
    assert.deepEqual(disconnected.nodes.find((node) => node.id === generator.id).generation.selectedReferenceNodeIds, [textNode.id]);
    await request(`/api/edges/${textConnection.edge.id}`, { method: "DELETE" });
    const fullyDisconnected = await request(`/api/projects/${project.id}`);
    assert.equal(fullyDisconnected.edges.length, 0);
    assert.equal(fullyDisconnected.nodes.find((node) => node.id === generator.id).generation.linkedReferences.length, 0);
    assert.deepEqual(fullyDisconnected.nodes.find((node) => node.id === generator.id).generation.selectedReferenceNodeIds, []);

    const ranged = await fetch(`${baseUrl}${nodes[0].url}`, { headers: { Range: "bytes=0-5" } });
    assert.equal(ranged.status, 206);
    assert.equal((await ranged.arrayBuffer()).byteLength, 6);

    await request(`/api/projects/${project.id}/edges`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceNodeId: nodes[0].id, targetNodeId: generator.id }),
    });
    await request(`/api/nodes/${nodes[0].id}`, { method: "DELETE" });
    const afterSourceDelete = await request(`/api/projects/${project.id}`);
    assert.equal(afterSourceDelete.edges.length, 0);
    assert.equal(afterSourceDelete.nodes.length, 2);
  } finally {
    await request(`/api/projects/${project.id}`, { method: "DELETE" });
  }

  console.log("Smoke test passed: project, explicit references, clone/restore, batch move, generic connections, cycle guard, range serving, and cleanup.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
