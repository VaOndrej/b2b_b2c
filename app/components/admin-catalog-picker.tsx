import {
  startTransition,
  useDeferredValue,
  useEffect,
  useId,
  useState,
} from "react";
import {
  buildCatalogSearchUrl,
  defaultManualPlaceholder,
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
  name: "productId" | "collectionId";
  label: string;
  resourceType: CatalogResourceType;
  required?: boolean;
  endpoint?: string;
  minQueryLength?: number;
  limit?: number;
  searchPlaceholder?: string;
  manualPlaceholder?: string;
  initialValue?: string;
}

export function AdminCatalogPicker(props: AdminCatalogPickerProps) {
  const endpoint = props.endpoint ?? "/app/api/catalog-search";
  const minQueryLength = props.minQueryLength ?? 2;
  const limit = props.limit ?? 8;
  const inputId = useId();
  const resultsId = useId();
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [options, setOptions] = useState<CatalogSearchItem[]>([]);
  const [selectedId, setSelectedId] = useState(
    normalizeCatalogPickerValue(props.initialValue),
  );
  const [selectedDescription, setSelectedDescription] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState(
    normalizeCatalogPickerValue(props.initialValue),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    const normalizedQuery = deferredQuery.trim();
    if (normalizedQuery.length < minQueryLength) {
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
  }, [deferredQuery, endpoint, limit, minQueryLength, props.resourceType]);

  const onPick = (option: CatalogSearchItem) => {
    setSelectedId(option.id);
    setManualValue(option.id);
    setSelectedDescription(describeCatalogItem(option));
    setQuery("");
    setOptions([]);
    setErrorMessage(null);
  };

  const onManualChange = (nextValue: string) => {
    const normalized = normalizeCatalogPickerValue(nextValue);
    setManualValue(nextValue);
    setSelectedId(normalized);
    if (normalized !== selectedId) {
      setSelectedDescription(null);
    }
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
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            startTransition(() => {
              setQuery(nextValue);
            });
          }}
          aria-controls={resultsId}
          autoComplete="off"
        />
      </label>
      <s-text>
        Selected {props.resourceType}:{" "}
        <code>{selectedDescription ?? "none yet"}</code>
      </s-text>
      <label>
        Selected or manual {props.resourceType} GID
        <input
          type="text"
          name={props.name}
          required={props.required}
          value={manualValue}
          placeholder={
            props.manualPlaceholder ?? defaultManualPlaceholder(props.resourceType)
          }
          onChange={(event) => onManualChange(event.currentTarget.value)}
        />
      </label>
      {isLoading && <s-paragraph>Searching {props.resourceType}s...</s-paragraph>}
      {errorMessage && (
        <s-paragraph>Search error: {errorMessage}</s-paragraph>
      )}
      {!isLoading && !errorMessage && options.length > 0 && (
        <ul id={resultsId} style={{ margin: 0, paddingLeft: "1.25rem" }}>
          {options.map((option) => (
            <li key={option.id}>
              <button type="button" onClick={() => onPick(option)}>
                {describeCatalogItem(option)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </s-stack>
  );
}
