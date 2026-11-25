package com.crewcue.android.ui.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NameEditingTest {
    @Test
    fun savedNameShowsAsTextUntilEdit() {
        assertFalse(NameEditing.isEditing(requested = false, saved = "Pat"))
        assertTrue(NameEditing.isEditing(requested = true, saved = "Pat"))
    }

    @Test
    fun noSavedNameStartsInTheField() {
        assertTrue(NameEditing.isEditing(requested = false, saved = ""))
        assertTrue(NameEditing.isEditing(requested = false, saved = "  "))
    }

    @Test
    fun reloadWhileEditingKeepsTheDraft() {
        assertEquals("Patri", NameEditing.draftAfterReload("Patri", "Pat", requested = true))
        assertEquals("Pat", NameEditing.draftAfterReload("old", "Pat", requested = false))
    }
}
