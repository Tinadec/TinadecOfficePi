import { describe, expect, it } from "vitest";
import app from "./App.vue?raw";
import petWindowManager from "../electron/petWindow.cjs?raw";
import petStore from "../electron/petStore.cjs?raw";
import mainProcess from "../electron/main.cjs?raw";
import preload from "../electron/preload.cjs?raw";
import petPreview from "./components/PetPreview.vue?raw";
import desktopPetPage from "./pages/DesktopPetPage.vue?raw";
import router from "./router.ts?raw";
import settingsPage from "./pages/SettingsPage.vue?raw";
import settingsCss from "./settings/settings.css?raw";

describe("local pet window shell", () => {
	it("keeps pet windows local, transparent, and multi-instance", () => {
		expect(petWindowManager).toContain("const petWindows = new Map()");
		expect(petWindowManager).toContain("randomUUID()");
		expect(petWindowManager).toContain("entry.petId === petId");
		expect(petWindowManager).toContain("transparent: !noTransparency");
		expect(petWindowManager).toContain("skipTaskbar: true");
		expect(petWindowManager).toContain("alwaysOnTop: true");
		expect(petWindowManager).toContain("getPetPreferences(petId)");
		expect(petWindowManager).toContain(
			"entry.window.webContents.id === sender.id",
		);
		expect(petWindowManager).toContain(
			"setIgnoreMouseEvents(Boolean(clickThrough), { forward: true })",
		);
		expect(petWindowManager).toContain(
			"const hash = `/pet?instanceId=${encodeURIComponent(instanceId)}`",
		);
	});

	it("keeps Petdex download and local pet actions inside the desktop process", () => {
		const normalizedPetStore = petStore.replace(/"/g, "'");
		expect(preload).toContain(
			'ipcRenderer.invoke("tinadec:pet-create", petId)',
		);
		expect(preload).toContain(
			'ipcRenderer.invoke("tinadec:pet-close", instanceId)',
		);
		expect(preload).toContain(
			'ipcRenderer.invoke("tinadec:pet-download", slug)',
		);
		expect(preload).toContain(
			'ipcRenderer.invoke("tinadec:pet-open-folder", slug)',
		);
		expect(preload).toContain('ipcRenderer.invoke("tinadec:pet-remove", slug)');
		expect(normalizedPetStore).toContain(
			"const PETDEX_MANIFEST_URL = 'https://petdex.dev/api/manifest/v2'",
		);
		expect(normalizedPetStore).toContain("manifest.v !== 2");
		expect(normalizedPetStore).toContain("app.getPath('userData')");
		expect(normalizedPetStore).toContain("Petdex asset URL is not trusted");
		expect(normalizedPetStore).toContain("Referer: 'https://petdex.dev/'");
		expect(normalizedPetStore).toContain("const previewRequests = new Map()");
		expect(normalizedPetStore).toContain("MAX_PREVIEW_CACHE_BYTES");
		expect(mainProcess).toContain('scheme: "tinadec-pet-preview"');
		expect(mainProcess).toContain('protocol.handle("tinadec-pet-preview"');
		expect(normalizedPetStore).toContain(
			"await fs.rename(temporary, destination)",
		);
		expect(router.replace(/"/g, "'")).toContain("path: '/pet'");
		expect(app).toContain(
			"const isPetWindow = window.location.hash.startsWith('#/pet')",
		);
		expect(app).toContain(
			"if (!isPetWindow && !isChildWindow) startConnection()",
		);
		expect(desktopPetPage).toContain("background: transparent !important");
		expect(desktopPetPage).toContain("from '@/pets/petRuntime'");
		expect(desktopPetPage).toContain("requestAnimationFrame(draw)");
		expect(desktopPetPage).toContain("event.screenX");
		expect(desktopPetPage).toContain("getImageData");
		expect(desktopPetPage).toContain("Math.min(1.2, Math.max(0.18, next))");
		expect(desktopPetPage).toContain("setState('running-right')");
		expect(petStore).not.toContain("normalizePetDefinition");
		expect(preload).toContain('ipcRenderer.on("tinadec:pet-changed", handler)');
	});

	it("keeps downloaded pets above a lazy, incrementally rendered market gallery", () => {
		const downloadedSection = settingsPage.indexOf(
			'class="pets-section downloaded-pets-section"',
		);
		const marketSection = settingsPage.indexOf(
			'class="pets-section petdex-market-section"',
		);
		expect(downloadedSection).toBeGreaterThan(-1);
		expect(marketSection).toBeGreaterThan(downloadedSection);
		expect(settingsPage).toContain("const PET_CATALOG_PAGE_SIZE = 48");
		expect(settingsPage).toContain("new IntersectionObserver");
		expect(settingsPage).toContain('ref="petLoadMoreRef"');
		expect(settingsPage).toContain("t('settings.loadMorePets'");
		expect(settingsPage).toContain('loading="lazy"');
	});

	it("shows stable preview loading states and constrains card content", () => {
		expect(settingsPage).toContain("<PetPreview");
		expect(settingsPage).toContain('class="pet-action-label"');
		expect(petPreview).toContain('<UiSkeleton v-if="!loaded"');
		expect(petPreview).toContain('@error="markFailed"');
		expect(petPreview).toContain("setTimeout(() =>");
		expect(petPreview).toContain("t('settings.retryPetPreview')");
		expect(settingsCss).toContain("grid-template-columns: minmax(0, 1fr) auto");
		expect(settingsCss).toContain(".pet-action-label");
		expect(settingsCss).toContain("text-overflow: ellipsis");
	});
});
