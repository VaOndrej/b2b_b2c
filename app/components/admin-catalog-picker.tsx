import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useState,
} from "react";
import {
  buildCatalogSearchUrl,
  defaultSearchPlaceholder,
  describeCatalogItem,
  normalizeCatalogPickerValue,
  normalizeCatalogSearchItems,
} from "./admin-catalog-picker.shared.ts";
import type {
  CatalogResourceType,
  CatalogSearchItem,
} from "./admin-catalog-picker.shared.ts";

export interface AdminCatalogPickerProps {
  name: string;
  label: string;
  resourceType: CatalogResourceType;
  required?: boolean;
  endpoint?: string;
  minQueryLength?: number;
  limit?: number;
  searchPlaceholder?: string;
  initialValue?: string;
}

export function AdminCatalogPicker(props: AdminCatalogPickerProps) {
  const endpoint = props.endpoint ?? "/app/api/catalog-search";
  const minQueryLength = props.minQueryLength ?? 2;
  const limit = props.limit ?? 8;
  const supportsBrowseDropdown =
    props.resourceType === "product" || props.resourceType === "variant" || props.resourceType === "collection";
  const inputId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<CatalogSearchItem[]>([]);
  const [selectedId, setSelectedId] = useState(
    normalizeCatalogPickerValue(props.initialValue),
  );
  const [selectedDescription, setSelectedDescription] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const normalizedQuery = deferredQuery.trim();
    const shouldBrowse =
      supportsBrowseDropdown && isOpen && normalizedQuery.length === 0;
    const shouldSearch =
      normalizedQuery.length >= minQueryLength || shouldBrowse;

    if (!shouldSearch) {
      setIsLoading(false);
      setOptions([]);
      setErrorMessage(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function runSearch() {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const url = buildCatalogSearchUrl({
          endpoint,
          resourceType: props.resourceType,
          query: normalizedQuery,
          limit,
        });
        const response = await fetch(url, {
          method: "GET",
          headers: {
            accept: "application/json",
          },
          signal: controller.signal,
        });
        const payload = await response.json();
        if (cancelled || controller.signal.aborted) {
          return;
        }
        if (!response.ok) {
          throw new Error(
            normalizeCatalogPickerValue((payload as any)?.error) ||
              "Catalog search failed.",
          );
        }
        startTransition(() => {
          setOptions(normalizeCatalogSearchItems(payload));
        });
      } catch (error) {
        if (controller.signal.aborted || cancelled) {
          return;
        }
        setOptions([]);
        setErrorMessage(error instanceof Error ? error.message : "Catalog search failed.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    runSearch();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    deferredQuery,
    endpoint,
    isOpen,
    limit,
    minQueryLength,
    props.resourceType,
    supportsBrowseDropdown,
  ]);

  const onPick = (option: CatalogSearchItem) => {
    setSelectedId(option.id);
    setSelectedDescription(describeCatalogItem(option));
    setQuery("");
    setOptions([]);
    setIsOpen(false);
    setErrorMessage(null);
  };

  return (
    <s-stack direction="block" gap="small">
      <label htmlFor={inputId}>
        {props.label}
        <input
          id={inputId}
          type="search"
          value={query}
          placeholder={
            props.searchPlaceholder ?? defaultSearchPlaceholder(props.resourceType)
          }
          onFocus={() => {
            setIsOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setIsOpen(false);
            }, 120);
          }}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            startTransition(() => {
              setQuery(nextValue);
              setIsOpen(true);
            });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
            }
          }}
          aria-controls={resultsId}
          autoComplete="off"
        />
      </label>
      <s-text>
        Selected {props.resourceType}:{" "}
        <code>{selectedDescription ?? "none yet"}</code>
      </s-text>
      <input
        type="hidden"
        name={props.name}
        required={props.required}
        value={selectedId}
      />
      {isLoading && <s-paragraph>Searching {props.resourceType}s...</s-paragraph>}
      {errorMessage && (
        <s-paragraph>Search error: {errorMessage}</s-paragraph>
      )}
      {!isLoading && !errorMessage && isOpen && options.length > 0 && (
        <ul
          id={resultsId}
          style={{
            margin: 0,
            padding: "8px",
            listStyle: "none",
            border: "1px solid #d0d5dd",
            borderRadius: "10px",
            background: "#ffffff",
            boxShadow: "0 8px 24px rgba(16, 24, 40, 0.08)",
            maxHeight: "280px",
            overflowY: "auto",
          }}
        >
          {options.map((option) => (
            <li key={option.id} style={{ margin: 0 }}>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(option);
                }}
                style={{
                  width: "100%",
                  border: "none",
                  background: "transparent",
                  color: "#101828",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  minHeight: "auto",
                  display: "block",
                  fontSize: "14px",
                  fontWeight: 500,
                  lineHeight: 1.4,
                }}
              >
                {describeCatalogItem(option)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </s-stack>
  );
}
