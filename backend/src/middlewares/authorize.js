/**
 * Verifica se req.user.role está entre os roles permitidos.
 * Deve ser usado APÓS authenticate().
 *
 * Uso: router.delete('/:id', authenticate, authorize('super_admin', 'dept_admin'), handler)
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Não autenticado.' })
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Acesso negado. Requer um dos papéis: ${roles.join(', ')}.`,
      })
    }
    next()
  }
}
