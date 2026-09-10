// Existing projects remain shared. Private projects never grant an admin bypass.
module.exports = function projectAccess({ app, db, enabled }) {
  const visibility = p => p.visibility === 'personal' ? 'personal' : 'team';
  const readable = (p, user) => !!p && (!enabled || visibility(p) === 'team' || (!!user && p.ownerId === user.id));
  const manageable = (p, user) => readable(p, user) && (!enabled || p.ownerId === user?.id || (!p.ownerId && user?.role === 'admin'));
  function guard(resolve) {
    return (req, res, next) => {
      if (!readable(db.projects.find(p => p.id === resolve(req)), req.user)) return res.status(404).json({ error: '项目不存在或无权访问' });
      next();
    };
  }
  app.use('/api/projects/:projectId', guard(req => req.params.projectId));
  app.use('/api/nodes/:nodeId', guard(req => db.nodes.find(n => n.id === req.params.nodeId)?.projectId));
  app.use('/api/edges/:edgeId', guard(req => db.edges.find(e => e.id === req.params.edgeId)?.projectId));
  app.use('/uploads/:projectId', guard(req => req.params.projectId));
  app.post('/api/uploads/init', guard(req => req.body?.projectId));
  app.use('/api/uploads/:id', (req, res, next) => {
    if (req.params.id === 'init') return next();
    guard(r => db.uploadTickets[r.params.id]?.projectId)(req, res, next);
  });
  return { visibility, readable, manageable };
};
