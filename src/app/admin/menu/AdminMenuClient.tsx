"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { adminNav } from "@/components/portalNav";
import { CoffeeArt, artKindForCategory } from "@/components/CoffeeArt";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { useFeedback } from "@/components/Feedback";
import type { Addon, Category, MenuItem, User } from "@/lib/types";
import { peso } from "@/lib/format";

type Tab = "menu" | "addons" | "accounts";

interface ItemForm {
  id?: number;
  name: string;
  description: string;
  image_url: string;
  price: string;
  category_id: string;
  stock_count: string;
  stock_status: "available" | "low" | "out";
  stock_note: string;
  is_best_seller: boolean;
  addonIds: number[];
  optionGroups: OptionGroupForm[];
}

interface OptionChoiceForm {
  name: string;
  price_modifier: string;
}

interface OptionGroupForm {
  type: string;
  options: OptionChoiceForm[];
}

const emptyForm: ItemForm = {
  name: "",
  description: "",
  image_url: "",
  price: "",
  category_id: "",
  stock_count: "",
  stock_status: "available",
  stock_note: "",
  is_best_seller: false,
  addonIds: [],
  optionGroups: [],
};

interface AddonForm {
  id?: number;
  name: string;
  price_modifier: string;
  is_active: boolean;
}

const emptyAddonForm: AddonForm = {
  name: "",
  price_modifier: "",
  is_active: true,
};

export function AdminMenuClient() {
  const feedback = useFeedback();
  const [tab, setTab] = useState<Tab>("menu");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyForm);
  const [itemAttempted, setItemAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [accountForm, setAccountForm] = useState({
    name: "",
    email: "",
    role: "staff",
    password: "",
  });
  const [accountAttempted, setAccountAttempted] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [addonModal, setAddonModal] = useState<"create" | "edit" | null>(null);
  const [addonForm, setAddonForm] = useState<AddonForm>(emptyAddonForm);
  const [addonAttempted, setAddonAttempted] = useState(false);
  const [savingAddon, setSavingAddon] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categoryAttempted, setCategoryAttempted] = useState(false);
  const [invalidReplacementCategory, setInvalidReplacementCategory] =
    useState<number | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [categoryReplacements, setCategoryReplacements] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const [menuRes, addonsRes, usersRes] = await Promise.all([
        fetch("/api/menu?all=1", { cache: "no-store" }),
        fetch("/api/addons?all=1", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
      ]);
      const menuData = await menuRes.json();
      const addonData = await addonsRes.json();
      const userData = await usersRes.json();
      if (!menuRes.ok || !menuData.success) {
        throw new Error(menuData.error || "Unable to load the menu.");
      }
      setItems(menuData.items || []);
      setCategories(menuData.categories || []);
      setAddons(addonData.addons || []);
      setUsers(userData.users || []);
      setError("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (categoryFilter === "all" || String(item.category_id) === categoryFilter) &&
        (!query ||
          item.name.toLowerCase().includes(query) ||
          (item.category_name || "").toLowerCase().includes(query))
    );
  }, [items, search, categoryFilter]);

  const openCreate = () => {
    const categoryId =
      categoryFilter !== "all" ? categoryFilter : String(categories[0]?.id || "");
    setForm({ ...emptyForm, category_id: categoryId });
    setItemAttempted(false);
    setModal("create");
  };

  const openEdit = (item: MenuItem) => {
    const groups = new Map<string, OptionGroupForm>();
    for (const variant of item.variants) {
      if (!groups.has(variant.variant_type)) {
        groups.set(variant.variant_type, { type: variant.variant_type, options: [] });
      }
      groups.get(variant.variant_type)!.options.push({
        name: variant.name,
        price_modifier: String(variant.price_modifier),
      });
    }
    setForm({
      id: item.id,
      name: item.name,
      description: item.description || "",
      image_url: item.image_url || "",
      price: String(item.price),
      category_id: String(item.category_id),
      stock_count: item.stock_tracking_enabled
        ? String(item.stock_count)
        : "",
      stock_status:
        item.stock_tracking_enabled && item.stock_count <= 0
          ? "out"
          : item.stock_status,
      stock_note: item.stock_note || "",
      is_best_seller: Boolean(item.is_best_seller),
      addonIds: item.extras.map((extra) => extra.id),
      optionGroups: Array.from(groups.values()),
    });
    setItemAttempted(false);
    setModal("edit");
  };

  const toggleFormAddon = (addonId: number) => {
    setForm((current) => ({
      ...current,
      addonIds: current.addonIds.includes(addonId)
        ? current.addonIds.filter((id) => id !== addonId)
        : [...current.addonIds, addonId],
    }));
  };

  const saveItem = async () => {
    setItemAttempted(true);
    if (!form.name.trim() || !form.price || !form.category_id) {
      feedback.warning("A few details are missing", {
        message: "Add a name, choose a category, and set a price before saving.",
      });
      return;
    }
    if (
      form.optionGroups.some(
        (group) =>
          !group.type.trim() || group.options.some((option) => !option.name.trim())
      )
    ) {
      feedback.warning("Finish the options first", {
        message: "Every option group needs a name, and each choice needs a label.",
      });
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      image_url: form.image_url,
      price: Number(form.price),
      category_id: Number(form.category_id),
      stock_count: form.stock_count.trim()
        ? Number(form.stock_count)
        : null,
      stock_tracking_enabled: form.stock_count.trim() !== "",
      stock_status: form.stock_count.trim()
        ? form.stock_status
        : form.stock_status === "out"
          ? "out"
          : "available",
      stock_note: form.stock_note.trim() || null,
      is_best_seller: form.is_best_seller,
      addonIds: form.addonIds,
      variants: form.optionGroups.map((group) => ({
        type: group.type,
        options: group.options.map((option) => ({
          name: option.name,
          price_modifier: Number(option.price_modifier || 0),
        })),
      })),
    };
    const editing = modal === "edit";
    const categoryName =
      categories.find((entry) => entry.id === Number(form.category_id))?.name ||
      "—";

    const result = await feedback.run(
      async () => {
        const response = await fetch(
          editing ? `/api/menu/${form.id}` : "/api/menu",
          {
            method: editing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not save the menu item.");
        }
        return data;
      },
      {
        loading: {
          title: editing ? "Updating the menu item…" : "Adding the menu item…",
          message: "Saving it for the customer menu.",
        },
        success: () => ({
          eyebrow: editing ? "Updated" : "Added",
          title: `${payload.name} ${editing ? "updated" : "added"}`,
          message: editing
            ? "The customer menu now shows these details."
            : "It is now available on the customer menu.",
          details: [
            { label: "Category", value: categoryName },
            { label: "Price", value: peso(payload.price) },
            {
              label: "Stock",
              value: payload.stock_tracking_enabled
                ? `${payload.stock_count} · ${payload.stock_status}`
                : "Quantity not tracked · available",
            },
            ...(payload.addonIds.length
              ? [{ label: "Add-ons", value: `${payload.addonIds.length} attached` }]
              : []),
          ],
        }),
      }
    );

    if (result.ok) {
      setModal(null);
      await load();
    }
    setSaving(false);
  };

  const uploadMenuImage = async (file: File | undefined) => {
    if (!file) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      feedback.warning("That image won't work", {
        message: "Choose a JPEG, PNG, or WebP file for the menu photo.",
      });
      return;
    }
    if (file.size > 1_000_000) {
      feedback.warning("That image is too large", {
        message: "Menu photos must be 1 MB or smaller.",
      });
      return;
    }

    try {
      // Phones load the menu over the cafe Wi-Fi, so downscale uploads before
      // they become part of the menu payload.
      const imageUrl = await prepareMenuImage(file);
      setForm((current) => ({ ...current, image_url: imageUrl }));
      setError("");
    } catch {
      feedback.error("Couldn't read that image", {
        message: "Try choosing the menu photo again.",
      });
    }
  };

  const addOptionGroup = () => {
    setForm((current) => ({
      ...current,
      optionGroups: [...current.optionGroups, { type: "", options: [{ name: "", price_modifier: "0" }] }],
    }));
  };

  const updateOptionGroup = (groupIndex: number, patch: Partial<OptionGroupForm>) => {
    setForm((current) => ({
      ...current,
      optionGroups: current.optionGroups.map((group, index) =>
        index === groupIndex ? { ...group, ...patch } : group
      ),
    }));
  };

  const updateOptionChoice = (
    groupIndex: number,
    optionIndex: number,
    patch: Partial<OptionChoiceForm>
  ) => {
    setForm((current) => ({
      ...current,
      optionGroups: current.optionGroups.map((group, index) =>
        index === groupIndex
          ? {
              ...group,
              options: group.options.map((option, choiceIndex) =>
                choiceIndex === optionIndex ? { ...option, ...patch } : option
              ),
            }
          : group
      ),
    }));
  };

  const saveCategory = async () => {
    setCategoryAttempted(true);
    if (!categoryName.trim()) {
      feedback.warning("Name the category first", {
        message: "Type a category name, like Pastries or Cold drinks.",
      });
      return;
    }
    setSavingCategory(true);
    setError("");
    const name = categoryName.trim();
    const result = await feedback.run(
      async () => {
        const response = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not create category.");
        }
        return data;
      },
      {
        loading: {
          title: "Adding the category…",
          message: "Organising the menu.",
        },
        success: () => ({
          eyebrow: "Added",
          title: `${name} added`,
          message: "Menu items can now be filed under this category.",
          details: [{ label: "Category", value: name }],
        }),
      }
    );
    if (result.ok && result.result) {
      setCategories((current) => [...current, result.result.category]);
      setCategoryFilter(String(result.result.category.id));
      setCategoryName("");
    }
    setSavingCategory(false);
  };

  const removeCategory = async (category: Category) => {
    const itemCount = items.filter((item) => item.category_id === category.id).length;
    const replacementId = categoryReplacements[category.id];
    if (itemCount > 0 && !replacementId) {
      setInvalidReplacementCategory(category.id);
      feedback.warning("Where should these items go?", {
        message: `"${category.name}" still holds ${itemCount} menu item${
          itemCount === 1 ? "" : "s"
        }. Choose a category to move them into first.`,
      });
      return;
    }
    setInvalidReplacementCategory(null);
    const replacementName = categories.find(
      (entry) => entry.id === Number(replacementId)
    )?.name;
    const prompt = itemCount > 0
      ? `Remove "${category.name}" and move its ${itemCount} menu item${itemCount === 1 ? "" : "s"} to "${replacementName}"?`
      : `Remove the empty category "${category.name}"?`;
    if (!window.confirm(prompt)) return;
    setSavingCategory(true);
    setError("");
    const result = await feedback.run(
      async () => {
        const response = await fetch("/api/categories", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: category.id,
            ...(replacementId ? { replacement_id: Number(replacementId) } : {}),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not remove category.");
        }
        return data;
      },
      {
        loading: {
          title: "Removing the category…",
          message: itemCount
            ? `Moving ${itemCount} item${itemCount === 1 ? "" : "s"} to ${replacementName}.`
            : "Tidying up the menu.",
        },
        success: () => ({
          eyebrow: "Removed",
          title: `${category.name} removed`,
          message: itemCount
            ? `Its ${itemCount} item${itemCount === 1 ? "" : "s"} now sit under ${replacementName}.`
            : "The empty category is gone from the menu.",
          details: itemCount
            ? [
                { label: "Category", value: category.name },
                { label: "Moved to", value: replacementName || "—" },
                { label: "Items moved", value: String(itemCount) },
              ]
            : [{ label: "Category", value: category.name }],
        }),
      }
    );
    if (result.ok) {
      setCategories((current) => current.filter((entry) => entry.id !== category.id));
      setItems((current) =>
        current.map((item) =>
          item.category_id === category.id && replacementId
            ? {
                ...item,
                category_id: Number(replacementId),
                category_name: categories.find((entry) => entry.id === Number(replacementId))?.name,
              }
            : item
        )
      );
      if (categoryFilter === String(category.id)) setCategoryFilter("all");
      setCategoryReplacements((current) => {
        const next = { ...current };
        delete next[category.id];
        return next;
      });
    }
    setSavingCategory(false);
  };

  const patchItem = async (item: MenuItem, payload: Record<string, unknown>) => {
    const label = Object.keys(payload)[0] || "menu item";
    const state =
      "is_active" in payload
        ? payload.is_active
          ? "visible"
          : "hidden"
        : "is_best_seller" in payload
          ? payload.is_best_seller
            ? "best seller"
            : "standard"
          : String(Object.values(payload)[0] ?? "");
    await feedback.run(
      async () => {
        const response = await fetch(`/api/menu/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update the menu item.");
        }
        return data;
      },
      {
        loading: {
          title: "Updating the menu item…",
          message: `Changing ${item.name}.`,
        },
        success: () => ({
          eyebrow: "Updated",
          title: item.name,
          message:
            label === "is_active"
              ? state === "visible"
                ? "It is back on the customer menu."
                : "It is hidden from the customer menu."
              : state === "best seller"
                ? "It now shows in the best sellers."
                : "It is no longer marked as a best seller.",
          duration: 1800,
        }),
      }
    );
    await load();
  };

  const deleteItem = async (item: MenuItem) => {
    if (!window.confirm(`Remove “${item.name}” from the menu?`)) return;
    const result = await feedback.run(
      async () => {
        const response = await fetch(`/api/menu/${item.id}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not remove the menu item.");
        }
        return data;
      },
      {
        loading: {
          title: "Removing the menu item…",
          message: `Taking ${item.name} off the menu.`,
        },
        success: () => ({
          eyebrow: "Removed",
          title: `${item.name} removed`,
          message: "It no longer appears on the customer menu. Past orders keep their record.",
          details: [
            { label: "Category", value: item.category_name || "—" },
            { label: "Price", value: peso(item.price) },
          ],
        }),
      }
    );
    if (result.ok) await load();
  };

  const createAccount = async () => {
    setAccountAttempted(true);
    if (
      !accountForm.name.trim() ||
      !accountForm.email.trim() ||
      !accountForm.password.trim()
    ) {
      feedback.warning("Some account details are missing", {
        message: "Add a name, email address, and temporary password to create the account.",
      });
      return;
    }
    setCreatingAccount(true);
    setError("");
    const account = { ...accountForm };
    const result = await feedback.run(
      async () => {
        const response = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(account),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not create account.");
        }
        return data;
      },
      {
        loading: {
          title: "Creating the account…",
          message: "Giving them access to the portal.",
        },
        success: () => ({
          eyebrow: "Account created",
          title: `${account.name} can sign in`,
          message: "Share the email and temporary password with them.",
          details: [
            { label: "Email", value: account.email.toLowerCase().trim() },
            { label: "Role", value: account.role === "admin" ? "Admin" : "Staff" },
          ],
        }),
      }
    );
    if (result.ok) {
      setAccountForm({ name: "", email: "", role: "staff", password: "" });
      setAccountAttempted(false);
      await load();
    }
    setCreatingAccount(false);
  };

  const removeAccount = async (user: User) => {
    if (!window.confirm(`Remove ${user.name}? They will lose access immediately.`)) return;
    const result = await feedback.run(
      async () => {
        const response = await fetch("/api/users", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: user.id }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not remove the account.");
        }
        return data;
      },
      {
        loading: {
          title: "Removing the account…",
          message: `Revoking ${user.name}'s access.`,
        },
        success: () => ({
          eyebrow: "Access revoked",
          title: `${user.name} removed`,
          message: "They can no longer sign in. Past activity stays in the log.",
          details: [
            { label: "Email", value: user.email },
            { label: "Role", value: user.role === "admin" ? "Admin" : "Staff" },
          ],
        }),
      }
    );
    if (result.ok) await load();
  };

  const openCreateAddon = () => {
    setAddonForm(emptyAddonForm);
    setAddonAttempted(false);
    setAddonModal("create");
  };

  const openEditAddon = (addon: Addon) => {
    setAddonForm({
      id: addon.id,
      name: addon.name,
      price_modifier: String(addon.price_modifier),
      is_active: Boolean(addon.is_active),
    });
    setAddonAttempted(false);
    setAddonModal("edit");
  };

  const saveAddon = async () => {
    setAddonAttempted(true);
    if (!addonForm.name.trim()) {
      feedback.warning("Give the add-on a name", {
        message: "Type what customers will see, like Oat milk or Extra shot.",
      });
      return;
    }
    setSavingAddon(true);
    setError("");
    const editing = addonModal === "edit";
    const addon = {
      name: addonForm.name.trim(),
      price_modifier: Number(addonForm.price_modifier) || 0,
      is_active: addonForm.is_active,
    };
    const result = await feedback.run(
      async () => {
        const response = await fetch(
          editing ? `/api/addons/${addonForm.id}` : "/api/addons",
          {
            method: editing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(addon),
          }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not save the add-on.");
        }
        return data;
      },
      {
        loading: {
          title: editing ? "Updating the add-on…" : "Adding the add-on…",
          message: "Saving it for the customer menu.",
        },
        success: () => ({
          eyebrow: editing ? "Updated" : "Added",
          title: `${addon.name} ${editing ? "updated" : "added"}`,
          message: addon.is_active
            ? "Customers can choose it with their drinks."
            : "It is saved but hidden from customers.",
          details: [
            {
              label: "Extra charge",
              value: addon.price_modifier ? `+${peso(addon.price_modifier)}` : "Free",
            },
            { label: "Visibility", value: addon.is_active ? "Visible" : "Hidden" },
          ],
        }),
      }
    );
    if (result.ok) {
      setAddonModal(null);
      await load();
    }
    setSavingAddon(false);
  };

  const patchAddon = async (addon: Addon, payload: Record<string, unknown>) => {
    const visible = Boolean(payload.is_active);
    await feedback.run(
      async () => {
        const response = await fetch(`/api/addons/${addon.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update the add-on.");
        }
        return data;
      },
      {
        loading: {
          title: "Updating the add-on…",
          message: `Changing ${addon.name}.`,
        },
        success: () => ({
          eyebrow: "Updated",
          title: addon.name,
          message: visible
            ? "Customers can choose it again."
            : "It is hidden from the customer menu.",
          duration: 1800,
        }),
      }
    );
    await load();
  };

  const deleteAddon = async (addon: Addon) => {
    if (
      !window.confirm(
        `Delete “${addon.name}”? It will be removed from every menu item and the customer menu. Past orders keep their record.`
      )
    ) {
      return;
    }
    const result = await feedback.run(
      async () => {
        const response = await fetch(`/api/addons/${addon.id}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not delete the add-on.");
        }
        return data;
      },
      {
        loading: {
          title: "Deleting the add-on…",
          message: `Removing ${addon.name} from the menu.`,
        },
        success: () => ({
          eyebrow: "Deleted",
          title: `${addon.name} removed`,
          message: "It is gone from every menu item. Past orders keep their record.",
          details: [
            {
              label: "Extra charge",
              value: addon.price_modifier ? `+${peso(addon.price_modifier)}` : "Free",
            },
          ],
        }),
      }
    );
    if (result.ok) await load();
  };

  return (
    <PortalShell
      area="admin"
      title="Menu & people."
      subtitle="Keep the menu current and the right people behind the counter."
      contextLabel="Admin · Menu & accounts"
      contextTitle={`${items.length} menu items · ${users.length} accounts`}
      nav={adminNav}
    >
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${tab === "menu" ? "active" : ""}`}
          onClick={() => setTab("menu")}
        >
          Menu items
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "addons" ? "active" : ""}`}
          onClick={() => setTab("addons")}
        >
          Add-ons
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "accounts" ? "active" : ""}`}
          onClick={() => setTab("accounts")}
        >
          Staff accounts
        </button>
      </div>

      {tab === "menu" ? (
        <>
          <div className="admin-menu-toolbar">
            <div className="search-box">
              <Icon name="search" />
              <input
                className="input"
                placeholder="Search the menu…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="admin-menu-toolbar-actions">
              <select
                className="select"
                aria-label="Filter category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  setCategoryAttempted(false);
                  setCategoryModal(true);
                }}
              >
                Categories
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
                <Icon name="plus" className="icon-sm" /> New item
              </button>
            </div>
          </div>

          <div className="panel">
            <div className="panel-body tight">
              {loading ? (
                <div className="loading-block">
                  <span className="spinner" /> Loading menu…
                </div>
              ) : (
                <div className="data-table-wrap">
                  <table className="data-table data-table-stack">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Price</th>
                        <th>Stock</th>
                        <th>Best seller</th>
                        <th>Visible</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => (
                        <tr key={item.id}>
                          <td data-label="">
                            <div className="item-cell">
                              <span className="item-cell-art">
                                <CoffeeArt
                                  kind={artKindForCategory(item.category_name, item.name)}
                                  variant="icon"
                                />
                              </span>
                              <div>
                                <strong>{item.name}</strong>
                                <span>{item.category_name}</span>
                              </div>
                            </div>
                          </td>
                          <td data-label="Price">{peso(item.price)}</td>
                          <td data-label="Stock">
                            <span className={`stock-indicator ${item.stock_status}`}>
                              {item.stock_status}
                            </span>
                          </td>
                          <td data-label="Best seller">
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={Boolean(item.is_best_seller)}
                                onChange={(event) =>
                                  patchItem(item, { is_best_seller: event.target.checked })
                                }
                                aria-label={`Toggle best seller for ${item.name}`}
                              />
                              <span className="toggle-track" />
                            </label>
                          </td>
                          <td data-label="Visible">
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={Boolean(item.is_active)}
                                onChange={(event) =>
                                  patchItem(item, { is_active: event.target.checked })
                                }
                                aria-label={`Toggle visibility for ${item.name}`}
                              />
                              <span className="toggle-track" />
                            </label>
                          </td>
                          <td data-label="Actions">
                            <div className="table-actions">
                              <button
                                type="button"
                                className="table-icon-btn"
                                title="Edit item"
                                onClick={() => openEdit(item)}
                              >
                                <Icon name="edit" />
                              </button>
                              <button
                                type="button"
                                className="table-icon-btn danger"
                                title="Remove item"
                                onClick={() => deleteItem(item)}
                              >
                                <Icon name="trash" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : tab === "addons" ? (
        <>
          <div className="admin-menu-toolbar">
            <div>
              <h2 style={{ fontFamily: "var(--serif)", fontSize: 24, fontWeight: 500 }}>
                Add-on catalog
              </h2>
              <p style={{ color: "var(--muted)", fontSize: 10 }}>
                Pearl, nata, cheese foam and more. Assign them to menu items below.
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreateAddon}>
              <Icon name="plus" className="icon-sm" /> New add-on
            </button>
          </div>

          <div className="panel">
            <div className="panel-body tight">
              {addons.length === 0 ? (
                <div className="empty-panel" style={{ border: 0 }}>
                  No add-ons yet. Add your first topping or extra.
                </div>
              ) : (
                <div className="data-table-wrap">
                  <table className="data-table data-table-stack">
                    <thead>
                      <tr>
                        <th>Add-on</th>
                        <th>Price</th>
                        <th>Visible to customers</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {addons.map((addon) => (
                        <tr key={addon.id}>
                          <td data-label="">
                            <strong>{addon.name}</strong>
                          </td>
                          <td data-label="Price">+{peso(addon.price_modifier)}</td>
                          <td data-label="Visible">
                            <label className="toggle-switch">
                              <input
                                type="checkbox"
                                checked={Boolean(addon.is_active)}
                                onChange={(event) =>
                                  patchAddon(addon, { is_active: event.target.checked })
                                }
                                aria-label={`Toggle visibility for ${addon.name}`}
                              />
                              <span className="toggle-track" />
                            </label>
                          </td>
                          <td data-label="Actions">
                            <div className="table-actions">
                              <button
                                type="button"
                                className="table-icon-btn"
                                title="Edit add-on"
                                onClick={() => openEditAddon(addon)}
                              >
                                <Icon name="edit" />
                              </button>
                              <button
                                type="button"
                                className="table-icon-btn danger"
                                title="Delete add-on"
                                onClick={() => deleteAddon(addon)}
                              >
                                <Icon name="trash" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div className="payment-note" style={{ marginTop: 13 }}>
            <Icon name="info" />
            <span>
              Add-ons only appear on the customer item screen for the menu items you
              assign them to. Open a menu item and tick its add-ons to change the
              selection.
            </span>
          </div>
        </>
      ) : (
        <div className="admin-two">
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Team accounts</h2>
                <p>Staff accounts use service tools; admin accounts manage menus and team settings.</p>
              </div>
              <span className="badge badge-cream">{users.length}</span>
            </div>
            <div className="panel-body">
              <div className="account-list">
                {users.map((user) => (
                  <div className="account-row" key={user.id}>
                    <span className="avatar">
                      {user.name
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <div className="account-info">
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                    </div>
                    <span className={`badge ${user.role === "admin" ? "badge-dark" : "badge-cream"}`}>
                      {user.role}
                    </span>
                    <button
                      type="button"
                      className="table-icon-btn danger"
                      title="Remove account"
                      onClick={() => removeAccount(user)}
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Add an account</h2>
                <p>Create credentials for a new team member.</p>
              </div>
            </div>
            <div className="panel-body">
              <div className="invite-form">
                <div className="field">
                  <label className="label" htmlFor="acc-name">Full name (required)</label>
                  <input
                    id="acc-name"
                    className="input"
                    value={accountForm.name}
                    required
                    aria-invalid={accountAttempted && !accountForm.name.trim()}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Juan Dela Cruz"
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="acc-email">Email (required)</label>
                  <input
                    id="acc-email"
                    className="input"
                    type="email"
                    value={accountForm.email}
                    required
                    aria-invalid={accountAttempted && !accountForm.email.trim()}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, email: event.target.value }))
                    }
                    placeholder="juan@merrylane.com"
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="acc-role">Role</label>
                  <select
                    id="acc-role"
                    className="select"
                    value={accountForm.role}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, role: event.target.value }))
                    }
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="acc-password">Temporary password (required)</label>
                  <input
                    id="acc-password"
                    className="input"
                    type="text"
                    value={accountForm.password}
                    required
                    aria-invalid={accountAttempted && !accountForm.password.trim()}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="At least 6 characters"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={creatingAccount}
                  onClick={createAccount}
                >
                  {creatingAccount ? <LoadingDots label="Creating" /> : "Create account"}
                </button>
                <div className="payment-note" style={{ marginTop: 0 }}>
                  <Icon name="shield" />
                  <span>Share the temporary password privately. Accounts can be removed at any time.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{modal === "edit" ? "Edit item" : "New menu item"}</h2>
              <button type="button" onClick={() => setModal(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label className="label" htmlFor="item-name">Name (required)</label>
                <input
                  id="item-name"
                  className="input"
                  value={form.name}
                  required
                  aria-invalid={itemAttempted && !form.name.trim()}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Spanish Latte"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="item-description">Description</label>
                <textarea
                  id="item-description"
                  className="textarea"
                  style={{ minHeight: 64 }}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                  placeholder="A short, appetising description"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="item-image">Menu photo</label>
                <div className="admin-menu-image-upload">
                  <div className="admin-menu-image-preview">
                    {form.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={form.image_url} alt={`${form.name || "Menu item"} preview`} />
                    ) : (
                      <CoffeeArt kind={artKindForCategory(
                        categories.find((category) => String(category.id) === form.category_id)?.name,
                        form.name
                      )} />
                    )}
                  </div>
                  <div className="admin-menu-image-controls">
                    <input
                      id="item-image"
                      className="input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        uploadMenuImage(event.target.files?.[0]);
                        event.currentTarget.value = "";
                      }}
                    />
                    <small>JPEG, PNG, or WebP · max 1 MB</small>
                    {form.image_url && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setForm((current) => ({ ...current, image_url: "" }))}
                      >
                        Remove photo
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="modal-form-row">
                <div className="field">
                  <label className="label" htmlFor="item-price">Price (₱) (required)</label>
                  <input
                    id="item-price"
                    className="input"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.price}
                    required
                    aria-invalid={itemAttempted && !form.price}
                    onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="item-category">Category (required)</label>
                  <select
                    id="item-category"
                    className="select"
                    value={form.category_id}
                    required
                    aria-invalid={itemAttempted && !form.category_id}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, category_id: event.target.value }))
                    }
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="modal-form-row">
                <div className="field">
                  <label className="label" htmlFor="item-stock">Stock on hand (optional)</label>
                  <input
                    id="item-stock"
                    className="input"
                    type="number"
                    min={0}
                    step={1}
                    value={form.stock_count}
                    onChange={(event) => {
                      const raw = event.target.value;
                      const hasValue = raw.trim() !== "";
                      setForm((current) => ({
                        ...current,
                        stock_count: raw,
                        stock_status:
                          !hasValue
                            ? current.stock_status
                            : Number(raw) <= 0
                              ? "out"
                              : current.stock_status === "out"
                                ? "available"
                                : current.stock_status,
                      }));
                    }}
                  />
                  <small className="muted">
                    Leave blank to mark it available without tracking a quantity.
                  </small>
                </div>
                <div className="field">
                  <label className="label" htmlFor="item-status">Stock status</label>
                  <select
                    id="item-status"
                    className="select"
                    value={form.stock_status}
                    onChange={(event) => {
                      const next = event.target.value as ItemForm["stock_status"];
                      setForm((current) => ({
                        ...current,
                        stock_status: next,
                        // Sold out always means zero on hand.
                        stock_count: next === "out" ? "0" : current.stock_count,
                      }));
                    }}
                  >
                    <option
                      value="available"
                      disabled={
                        form.stock_count.trim() !== "" &&
                        Number(form.stock_count) <= 0
                      }
                    >
                      Available
                    </option>
                    <option
                      value="low"
                      disabled={
                        form.stock_count.trim() === "" ||
                        Number(form.stock_count) <= 0
                      }
                    >
                      Low stock
                    </option>
                    <option value="out">Sold out</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="item-note">Customer stock note</label>
                <input
                  id="item-note"
                  className="input"
                  value={form.stock_note}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, stock_note: event.target.value }))
                  }
                  placeholder="Only a few left today"
                />
              </div>
              <div className="field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <label className="label" style={{ margin: 0 }}>Choose-one option groups</label>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    disabled={form.optionGroups.length >= 25}
                    onClick={addOptionGroup}
                  >
                    <Icon name="plus" className="icon-sm" /> Add group
                  </button>
                </div>
                <p className="muted" style={{ fontSize: 10, marginTop: 5 }}>
                  Create as many groups as you need, such as Size, Temperature, Sugar level, or Milk.
                  Add as many choices as needed; customers choose one from each group.
                </p>
                {form.optionGroups.map((group, groupIndex) => (
                  <div
                    key={groupIndex}
                    style={{
                      border: "1px solid var(--line)",
                      borderRadius: 9,
                      padding: 10,
                      marginTop: 8,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <input
                        className="input"
                        aria-label={`Option group ${groupIndex + 1} name`}
                        placeholder="Group name, e.g. Temperature"
                        maxLength={40}
                        value={group.type}
                        aria-invalid={itemAttempted && !group.type.trim()}
                        onChange={(event) => updateOptionGroup(groupIndex, { type: event.target.value })}
                      />
                      <button
                        type="button"
                        className="table-icon-btn danger"
                        title="Remove option group"
                        aria-label="Remove option group"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            optionGroups: current.optionGroups.filter((_, index) => index !== groupIndex),
                          }))
                        }
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                    {group.options.map((option, optionIndex) => (
                      <div
                        key={optionIndex}
                        className="modal-form-row"
                        style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(100px, 0.45fr) auto" }}
                      >
                        <input
                          className="input"
                          aria-label={`${group.type || "Option"} choice ${optionIndex + 1}`}
                          placeholder="Choice, e.g. Hot"
                          maxLength={60}
                          value={option.name}
                          aria-invalid={itemAttempted && !option.name.trim()}
                          onChange={(event) =>
                            updateOptionChoice(groupIndex, optionIndex, { name: event.target.value })
                          }
                        />
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={`${option.name || "Choice"} extra price`}
                          placeholder="Extra ₱"
                          value={option.price_modifier}
                          onChange={(event) =>
                            updateOptionChoice(groupIndex, optionIndex, {
                              price_modifier: event.target.value,
                            })
                          }
                        />
                        <button
                          type="button"
                          className="table-icon-btn danger"
                          title="Remove choice"
                          aria-label="Remove choice"
                          disabled={group.options.length === 1}
                          onClick={() =>
                            updateOptionGroup(groupIndex, {
                              options: group.options.filter((_, index) => index !== optionIndex),
                            })
                          }
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ justifySelf: "start" }}
                      disabled={group.options.length >= 50}
                      onClick={() =>
                        updateOptionGroup(groupIndex, {
                          options: [...group.options, { name: "", price_modifier: "0" }],
                        })
                      }
                    >
                      <Icon name="plus" className="icon-sm" /> Add choice
                    </button>
                  </div>
                ))}
                {form.optionGroups.length === 0 && (
                  <p className="muted" style={{ fontSize: 10 }}>No custom choices for this item.</p>
                )}
              </div>
              <div className="field">
                <label className="label">Add-ons offered for this item</label>
                {addons.length === 0 ? (
                  <p className="muted" style={{ fontSize: 10 }}>
                    No add-ons yet. Create them from the Add-ons tab first.
                  </p>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 7,
                      maxHeight: 190,
                      overflowY: "auto",
                      paddingRight: 2,
                    }}
                  >
                    {addons.map((addon) => (
                      <label className="checkline" key={addon.id}>
                        <input
                          type="checkbox"
                          checked={form.addonIds.includes(addon.id)}
                          onChange={() => toggleFormAddon(addon.id)}
                        />
                        <span>
                          {addon.name}{" "}
                          <span className="muted">+{peso(addon.price_modifier)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={form.is_best_seller}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, is_best_seller: event.target.checked }))
                  }
                />
                Show as a best seller on the menu
              </label>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={saving} onClick={saveItem}>
                {saving ? <LoadingDots label="Saving" /> : modal === "edit" ? "Save changes" : "Add to menu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {categoryModal && (
        <div className="modal-backdrop" onClick={() => setCategoryModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>Manage categories</h2>
              <button
                type="button"
                onClick={() => setCategoryModal(false)}
                aria-label="Close"
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <p className="muted" style={{ fontSize: 10, margin: 0 }}>
                Add categories or remove ones you no longer use. Items in a removed category can be moved to another category.
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto",
                  gap: 8,
                  alignItems: "end",
                }}
              >
                <div className="field" style={{ margin: 0 }}>
                  <label className="label" htmlFor="category-name">New category (required)</label>
                  <input
                    id="category-name"
                    className="input"
                    maxLength={40}
                    value={categoryName}
                    required
                    aria-invalid={categoryAttempted && !categoryName.trim()}
                    onChange={(event) => setCategoryName(event.target.value)}
                    placeholder="Seasonal drinks"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingCategory}
                  onClick={saveCategory}
                >
                  <Icon name="plus" className="icon-sm" /> Add
                </button>
              </div>
              <div style={{ display: "grid", gap: 8, maxHeight: 330, overflowY: "auto" }}>
                {categories.map((category) => {
                  const itemCount = items.filter((item) => item.category_id === category.id).length;
                  return (
                    <div
                      key={category.id}
                      style={{
                        border: "1px solid var(--line)",
                        borderRadius: 9,
                        padding: 10,
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: 9,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ display: "block", fontSize: 12 }}>{category.name}</strong>
                        <span className="muted" style={{ fontSize: 10 }}>
                          {itemCount} menu item{itemCount === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                        {itemCount > 0 && (
                          <select
                            className="select"
                            aria-label={`Move items from ${category.name} to`}
                            value={categoryReplacements[category.id] || ""}
                            required={itemCount > 0}
                            aria-invalid={invalidReplacementCategory === category.id}
                            onChange={(event) =>
                              {
                                setInvalidReplacementCategory(null);
                                setCategoryReplacements((current) => ({
                                  ...current,
                                  [category.id]: event.target.value,
                                }));
                              }
                            }
                          >
                            <option value="">Move items to…</option>
                            {categories
                              .filter((entry) => entry.id !== category.id)
                              .map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                  {entry.name}
                                </option>
                              ))}
                          </select>
                        )}
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          disabled={savingCategory || categories.length <= 1}
                          onClick={() => removeCategory(category)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setCategoryModal(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {addonModal && (
        <div className="modal-backdrop" onClick={() => setAddonModal(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{addonModal === "edit" ? "Edit add-on" : "New add-on"}</h2>
              <button type="button" onClick={() => setAddonModal(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label className="label" htmlFor="addon-name">Name (required)</label>
                <input
                  id="addon-name"
                  className="input"
                  value={addonForm.name}
                  required
                  aria-invalid={addonAttempted && !addonForm.name.trim()}
                  onChange={(event) =>
                    setAddonForm((current) => ({ ...current, name: event.target.value }))
                  }
                  placeholder="Pearl"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="addon-price">Extra charge (₱)</label>
                <input
                  id="addon-price"
                  className="input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={addonForm.price_modifier}
                  onChange={(event) =>
                    setAddonForm((current) => ({
                      ...current,
                      price_modifier: event.target.value,
                    }))
                  }
                  placeholder="20"
                />
              </div>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={addonForm.is_active}
                  onChange={(event) =>
                    setAddonForm((current) => ({
                      ...current,
                      is_active: event.target.checked,
                    }))
                  }
                />
                Show this add-on on the customer menu
              </label>
              <div className="payment-note" style={{ marginTop: 0 }}>
                <Icon name="info" />
                <span>
                  After saving, open a menu item to choose which drinks or pastries
                  offer this add-on.
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline" onClick={() => setAddonModal(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={savingAddon} onClick={saveAddon}>
                {savingAddon ? <LoadingDots label="Saving" /> : addonModal === "edit" ? "Save changes" : "Add add-on"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PortalShell>
  );
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The selected image could not be read."));
    };
    reader.onerror = () => reject(reader.error || new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The selected image could not be read."));
    image.src = src;
  });
}

async function prepareMenuImage(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(dataUrl).catch(() => null);
  if (!image) return dataUrl;

  const maxSide = 1000;
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longestSide > 0 ? Math.min(1, maxSide / longestSide) : 1;
  if (scale === 1 && file.size <= 260_000) return dataUrl;

  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return dataUrl;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const jpeg = canvas.toDataURL("image/jpeg", 0.82);
  return jpeg.length < dataUrl.length ? jpeg : dataUrl;
}
