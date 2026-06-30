import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import Header      from './Header'
import Sidebar     from './Sidebar'
import ShortcutBar from '../shortcuts/ShortcutBar'
import { useDemandTypeStore }   from '../../stores/demandTypeStore'
import { useNotificationStore } from '../../stores/notificationStore'

export default function AppLayout() {
  const [sidebarPinned, setSidebarPinned] = useState(
    () => localStorage.getItem('sidebar-pinned') !== 'false'
  )

  function toggleSidebarPin() {
    setSidebarPinned(prev => {
      const next = !prev
      localStorage.setItem('sidebar-pinned', next)
      return next
    })
  }

  useEffect(() => {
    useDemandTypeStore.getState().fetchDemandTypes()
  }, [])

  useEffect(() => {
    useNotificationStore.getState().connect()
    return () => useNotificationStore.getState().disconnect()
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <ShortcutBar />
      <Sidebar pinned={sidebarPinned} onTogglePin={toggleSidebarPin} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onToggleSidebar={toggleSidebarPin} sidebarPinned={sidebarPinned} />
        <main className="flex-1 overflow-auto ml-56">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
