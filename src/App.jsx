import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import './App.css'

const initialForm = {
  sr_no: '',
  description: '',
  model_no: '',
  location: '',
  unit: 'pcs',
  current_qty: '',
  min_stock_level: '',
  need_to_order: false,
}

function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const [items, setItems] = useState([])
  const [history, setHistory] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [editingItemId, setEditingItemId] = useState(null)
  const [form, setForm] = useState(initialForm)
  const [qtyInputs, setQtyInputs] = useState({})

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase())
    }, 250)

    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    getInitialSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setAuthLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) {
      fetchAll()
    }
  }, [session])

  async function getInitialSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    setSession(session)
    setAuthLoading(false)
  }

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setSuccessMessage('')

    if (!email || !password) {
      setError('Email and password are required.')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
    } else {
      setSuccessMessage('Login successful.')
      setEmail('')
      setPassword('')
    }
  }

  async function handleLogout() {
    setError('')
    setSuccessMessage('')

    const { error } = await supabase.auth.signOut()

    if (error) {
      setError(error.message)
    } else {
      setSuccessMessage('Logged out successfully.')
      setItems([])
      setHistory([])
    }
  }

  async function fetchAll() {
    await Promise.all([fetchItems(), fetchHistory()])
  }

  async function fetchItems() {
    try {
      setLoading(true)
      setError('')

      const { count, error: countError } = await supabase
        .from('items')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)

      if (countError) throw countError
      setTotalCount(count || 0)

      const { data, error } = await supabase
        .from('items')
        .select(
          'id, sr_no, description, model_no, location, unit, current_qty, min_stock_level, need_to_order, is_active'
        )
        .eq('is_active', true)
        .order('description', { ascending: true })
        .range(0, 10000)

      if (error) throw error

      const prepared = (data || []).map((item) => ({
        ...item,
        _search:
          `${item.sr_no || ''} ${item.description || ''} ${item.model_no || ''} ${item.location || ''}`.toLowerCase(),
      }))

      setItems(prepared)
    } catch (err) {
      setError(err.message || 'Failed to load items')
    } finally {
      setLoading(false)
    }
  }

  async function fetchHistory() {
    const { data, error } = await supabase
      .from('inventory_history')
      .select(
        'id, item_id, item_name, action_type, change_qty, old_qty, new_qty, note, performed_by, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      setError(error.message)
    } else {
      setHistory(data || [])
    }
  }

  async function logHistory({
    itemId,
    itemName,
    actionType,
    changeQty = null,
    oldQty = null,
    newQty = null,
    note = null,
  }) {
    const performedBy = session?.user?.email || 'unknown'

    await supabase.from('inventory_history').insert([
      {
        item_id: itemId || null,
        item_name: itemName || null,
        action_type: actionType,
        change_qty: changeQty,
        old_qty: oldQty,
        new_qty: newQty,
        note,
        performed_by: performedBy,
      },
    ])
  }

  function getStatus(item) {
    const qty = Number(item.current_qty || 0)
    const min = Number(item.min_stock_level || 0)

    if (qty <= 0) return 'Out of Stock'
    if (qty <= min) return 'Low Stock'
    return 'Available'
  }

  function getStatusClass(item) {
    const status = getStatus(item)
    if (status === 'Out of Stock') return 'status-badge out-of-stock'
    if (status === 'Low Stock') return 'status-badge low-stock'
    return 'status-badge available'
  }

  const outOfStockItems = useMemo(
    () => items.filter((item) => Number(item.current_qty || 0) <= 0),
    [items]
  )

  const lowStockItems = useMemo(
    () =>
      items.filter((item) => {
        const qty = Number(item.current_qty || 0)
        const min = Number(item.min_stock_level || 0)
        return qty > 0 && qty <= min
      }),
    [items]
  )

  const needToOrderItems = useMemo(
    () => items.filter((item) => item.need_to_order === true),
    [items]
  )

  const filteredItems = useMemo(() => {
    let base = items

    if (filter === 'LOW') {
      base = lowStockItems
    } else if (filter === 'OUT') {
      base = outOfStockItems
    } else if (filter === 'ORDER') {
      base = needToOrderItems
    }

    if (!debouncedSearch) return base.slice(0, 500)

    return base.filter((item) => item._search.includes(debouncedSearch)).slice(0, 500)
  }, [items, lowStockItems, outOfStockItems, needToOrderItems, filter, debouncedSearch])

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }))
  }

  function getNextSrNo() {
    const numericSrNos = items
      .map((item) => Number(String(item.sr_no || '').trim()))
      .filter((num) => !Number.isNaN(num) && Number.isFinite(num))

    if (numericSrNos.length === 0) return '1'
    return String(Math.max(...numericSrNos) + 1)
  }

  function resetForm() {
    setForm(initialForm)
    setEditingItemId(null)
  }

  async function handleAddOrUpdateItem(e) {
    e.preventDefault()
    setError('')
    setSuccessMessage('')

    if (!form.description.trim()) {
      setError('Description is required.')
      return
    }

    setSaving(true)

    const finalSrNo = editingItemId
      ? form.sr_no.trim() || null
      : form.sr_no.trim() || getNextSrNo()

    const payload = {
      sr_no: finalSrNo,
      description: form.description.trim(),
      model_no: form.model_no.trim() || null,
      location: form.location.trim() || null,
      unit: form.unit.trim() || 'pcs',
      current_qty: Number(form.current_qty || 0),
      min_stock_level: Number(form.min_stock_level || 0),
      need_to_order: form.need_to_order,
      is_active: true,
    }

    if (editingItemId) {
      const oldItem = items.find((x) => x.id === editingItemId)

      const { error } = await supabase
        .from('items')
        .update(payload)
        .eq('id', editingItemId)

      if (error) {
        setError(error.message)
      } else {
        await logHistory({
          itemId: editingItemId,
          itemName: payload.description,
          actionType: 'EDIT_ITEM',
          oldQty: Number(oldItem?.current_qty || 0),
          newQty: Number(payload.current_qty || 0),
          note: 'Item details updated',
        })

        setSuccessMessage('Item updated successfully.')
        resetForm()
        await fetchAll()
      }
    } else {
      const { data, error } = await supabase
        .from('items')
        .insert([payload])
        .select()
        .single()

      if (error) {
        setError(error.message)
      } else {
        await logHistory({
          itemId: data?.id,
          itemName: payload.description,
          actionType: 'ADD_ITEM',
          changeQty: Number(payload.current_qty || 0),
          oldQty: 0,
          newQty: Number(payload.current_qty || 0),
          note: 'New item created',
        })

        setSuccessMessage(`Item added successfully. Sr.No: ${finalSrNo}`)
        resetForm()
        await fetchAll()
      }
    }

    setSaving(false)
  }

  function handleEdit(item) {
    setEditingItemId(item.id)
    setForm({
      sr_no: item.sr_no || '',
      description: item.description || '',
      model_no: item.model_no || '',
      location: item.location || '',
      unit: item.unit || 'pcs',
      current_qty: item.current_qty ?? '',
      min_stock_level: item.min_stock_level ?? '',
      need_to_order: item.need_to_order || false,
    })
    setSuccessMessage('')
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleQtyInputChange(itemId, value) {
    setQtyInputs((prev) => ({
      ...prev,
      [itemId]: value,
    }))
  }

  async function handleCustomQtyUpdate(item, mode) {
    setError('')
    setSuccessMessage('')

    const rawValue = qtyInputs[item.id]
    const changeQty = Number(rawValue)

    if (!rawValue || Number.isNaN(changeQty) || changeQty <= 0) {
      setError('Please enter a valid quantity greater than zero.')
      return
    }

    const currentQty = Number(item.current_qty || 0)
    const newQty = mode === 'add' ? currentQty + changeQty : currentQty - changeQty

    if (newQty < 0) {
      setError('Quantity cannot go below zero.')
      return
    }

    const { error } = await supabase
      .from('items')
      .update({ current_qty: newQty })
      .eq('id', item.id)

    if (error) {
      setError(error.message)
    } else {
      await logHistory({
        itemId: item.id,
        itemName: item.description,
        actionType: mode === 'add' ? 'QTY_ADD' : 'QTY_REMOVE',
        changeQty,
        oldQty: currentQty,
        newQty,
        note: mode === 'add' ? 'Custom quantity added' : 'Custom quantity removed',
      })

      setSuccessMessage(
        mode === 'add'
          ? `Added ${changeQty} to ${item.description}.`
          : `Removed ${changeQty} from ${item.description}.`
      )

      setQtyInputs((prev) => ({
        ...prev,
        [item.id]: '',
      }))

      await fetchAll()
    }
  }

  async function handleDeactivate(item) {
    const ok = window.confirm(`Deactivate "${item.description}"?`)
    if (!ok) return

    setError('')
    setSuccessMessage('')

    const { error } = await supabase
      .from('items')
      .update({ is_active: false })
      .eq('id', item.id)

    if (error) {
      setError(error.message)
    } else {
      await logHistory({
        itemId: item.id,
        itemName: item.description,
        actionType: 'DEACTIVATE_ITEM',
        oldQty: Number(item.current_qty || 0),
        newQty: Number(item.current_qty || 0),
        note: 'Item deactivated',
      })

      setSuccessMessage('Item deactivated successfully.')
      if (editingItemId === item.id) resetForm()
      await fetchAll()
    }
  }

  async function handleDownloadExcel() {
    const exportRows = items.map((item) => ({
      ID: item.id,
      'Sr.No': item.sr_no || '',
      Description: item.description || '',
      'Model No': item.model_no || '',
      Location: item.location || '',
      Unit: item.unit || 'pcs',
      Qty: Number(item.current_qty || 0),
      'Min Stock Level': Number(item.min_stock_level || 0),
      'Need To Order': item.need_to_order ? 'Yes' : 'No',
      Status: getStatus(item),
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory')
    XLSX.writeFile(
      workbook,
      `realize_workshop_inventory_${new Date().toISOString().slice(0, 10)}.xlsx`
    )
  }

  if (authLoading) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h2>Loading...</h2>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Inventory Login</h1>
          <p>Use your assigned email and password.</p>

          {error && <div className="alert-box error-box">Error: {error}</div>}
          {successMessage && (
            <div className="alert-box success-box">{successMessage}</div>
          )}

          <form className="auth-form" onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button className="add-btn" type="submit">
              Login
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-container">
        <div className="developer-tag">Developed by - Vijay</div>

        <div className="hero-card">
          <div className="hero-left">
            <p className="hero-badge">REALIZE WORKSHOP</p>
            <h1>Inventory Management Dashboard</h1>
            <p className="hero-subtitle">
              Logged in as: {session.user.email}
            </p>
          </div>

          <div className="top-actions">
            <button className="export-btn" onClick={handleDownloadExcel}>
              Download Excel
            </button>
            <button className="refresh-btn" onClick={fetchAll}>
              Refresh
            </button>
            <button className="secondary-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>

        {error && <div className="alert-box error-box">Error: {error}</div>}
        {successMessage && (
          <div className="alert-box success-box">{successMessage}</div>
        )}

        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Total Items</p>
            <h3>{totalCount}</h3>
          </div>

          <div className="stat-card">
            <p className="stat-label">Low Stock</p>
            <h3 className="warning">{lowStockItems.length}</h3>
          </div>

          <div className="stat-card">
            <p className="stat-label">Out of Stock</p>
            <h3 className="danger">{outOfStockItems.length}</h3>
          </div>

          <div className="stat-card">
            <p className="stat-label">Need To Order</p>
            <h3 className="info">{needToOrderItems.length}</h3>
          </div>
        </div>

        <div className="panel-card">
          <div className="section-header">
            <div>
              <h2>{editingItemId ? 'Edit Item' : 'Add New Item'}</h2>
              <p className="section-note">
                Sr.No blank chhodoge to auto-generate ho jayega.
              </p>
            </div>

            {editingItemId && (
              <button
                className="secondary-btn"
                type="button"
                onClick={resetForm}
              >
                Cancel Edit
              </button>
            )}
          </div>

          <form className="add-item-form" onSubmit={handleAddOrUpdateItem}>
            <input
              type="text"
              name="sr_no"
              placeholder="Sr.No (optional)"
              value={form.sr_no}
              onChange={handleChange}
            />
            <input
              type="text"
              name="description"
              placeholder="Description"
              value={form.description}
              onChange={handleChange}
            />
            <input
              type="text"
              name="model_no"
              placeholder="Model No"
              value={form.model_no}
              onChange={handleChange}
            />
            <input
              type="text"
              name="location"
              placeholder="Location"
              value={form.location}
              onChange={handleChange}
            />
            <input
              type="text"
              name="unit"
              placeholder="Unit"
              value={form.unit}
              onChange={handleChange}
            />
            <input
              type="number"
              name="current_qty"
              placeholder="Current Qty"
              value={form.current_qty}
              onChange={handleChange}
            />
            <input
              type="number"
              name="min_stock_level"
              placeholder="Min Stock Level"
              value={form.min_stock_level}
              onChange={handleChange}
            />

            <label className="checkbox-row">
              <input
                type="checkbox"
                name="need_to_order"
                checked={form.need_to_order}
                onChange={handleChange}
              />
              <span>Need To Order</span>
            </label>

            <button type="submit" className="add-btn" disabled={saving}>
              {saving
                ? 'Saving...'
                : editingItemId
                ? 'Update Item'
                : 'Add Item'}
            </button>
          </form>
        </div>

        <div className="panel-card">
          <div className="section-header section-header-stack">
            <div>
              <h2>All Inventory Items</h2>
              <p className="section-note">
                Fast search enabled. Search by item, model, location, or sr no.
              </p>
            </div>

            <div className="toolbar">
              <input
                type="text"
                className="search-input"
                placeholder="Search by item, model, location, sr no"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <div className="filter-group">
                <button
                  className={filter === 'ALL' ? 'filter-btn active' : 'filter-btn'}
                  onClick={() => setFilter('ALL')}
                  type="button"
                >
                  All
                </button>
                <button
                  className={filter === 'LOW' ? 'filter-btn active' : 'filter-btn'}
                  onClick={() => setFilter('LOW')}
                  type="button"
                >
                  Low Stock
                </button>
                <button
                  className={filter === 'OUT' ? 'filter-btn active' : 'filter-btn'}
                  onClick={() => setFilter('OUT')}
                  type="button"
                >
                  Out of Stock
                </button>
                <button
                  className={filter === 'ORDER' ? 'filter-btn active' : 'filter-btn'}
                  onClick={() => setFilter('ORDER')}
                  type="button"
                >
                  Need To Order
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="loading-text">Loading items...</div>
          ) : (
            <div className="table-wrap">
              <table className="items-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Sr.No</th>
                    <th>Description</th>
                    <th>Model No</th>
                    <th>Location</th>
                    <th>Unit</th>
                    <th>Qty</th>
                    <th>Min Stock</th>
                    <th>Need To Order</th>
                    <th>Status</th>
                    <th>Custom Qty Update</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan="12" className="empty-row">
                        No items found.
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.sr_no || '-'}</td>
                        <td>{item.description}</td>
                        <td>{item.model_no || '-'}</td>
                        <td>{item.location || '-'}</td>
                        <td>{item.unit || 'pcs'}</td>
                        <td>{item.current_qty}</td>
                        <td>{item.min_stock_level}</td>
                        <td>{item.need_to_order ? 'Yes' : 'No'}</td>
                        <td>
                          <span className={getStatusClass(item)}>
                            {getStatus(item)}
                          </span>
                        </td>
                        <td>
                          <div className="custom-qty-box">
                            <input
                              type="number"
                              min="1"
                              placeholder="Qty"
                              className="qty-input"
                              value={qtyInputs[item.id] || ''}
                              onChange={(e) =>
                                handleQtyInputChange(item.id, e.target.value)
                              }
                            />
                            <div className="qty-actions">
                              <button
                                className="qty-btn plus"
                                type="button"
                                onClick={() =>
                                  handleCustomQtyUpdate(item, 'add')
                                }
                              >
                                Add
                              </button>
                              <button
                                className="qty-btn minus"
                                type="button"
                                onClick={() =>
                                  handleCustomQtyUpdate(item, 'remove')
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="table-btn edit"
                              type="button"
                              onClick={() => handleEdit(item)}
                            >
                              Edit
                            </button>
                            <button
                              className="table-btn danger"
                              type="button"
                              onClick={() => handleDeactivate(item)}
                            >
                              Deactivate
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel-card">
          <div className="section-header">
            <h2>Activity History</h2>
          </div>

          <div className="table-wrap">
            <table className="items-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Item</th>
                  <th>Old Qty</th>
                  <th>Change</th>
                  <th>New Qty</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="empty-row">
                      No history found.
                    </td>
                  </tr>
                ) : (
                  history.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                      <td>{row.performed_by || '-'}</td>
                      <td>{row.action_type}</td>
                      <td>{row.item_name || '-'}</td>
                      <td>{row.old_qty ?? '-'}</td>
                      <td>{row.change_qty ?? '-'}</td>
                      <td>{row.new_qty ?? '-'}</td>
                      <td>{row.note || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App