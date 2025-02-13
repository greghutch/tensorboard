/* Copyright 2020 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
import {TestBed} from '@angular/core/testing';
import {Store} from '@ngrx/store';
import {MockStore, provideMockStore} from '@ngrx/store/testing';
import {skip} from 'rxjs/operators';

import {SerializableQueryParams} from '../app_routing/types';
import {State} from '../app_state';
import {PluginType} from '../metrics/data_source/types';
import {METRICS_SETTINGS_DEFAULT} from '../metrics/types';
import {appStateFromMetricsState, buildMetricsState} from '../metrics/testing';
import * as selectors from '../selectors';
import {DashboardDeepLinkProvider} from './dashboard_deeplink_provider';

describe('core deeplink provider', () => {
  let store: MockStore<State>;
  let provider: DashboardDeepLinkProvider;
  let queryParamsSerialized: SerializableQueryParams[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          initialState: {
            ...appStateFromMetricsState(buildMetricsState()),
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject<Store<State>>(Store) as MockStore<State>;
    store.overrideSelector(selectors.getPinnedCardsWithMetadata, []);
    store.overrideSelector(selectors.getUnresolvedImportedPinnedCards, []);
    store.overrideSelector(selectors.getEnabledExperimentalPlugins, []);
    store.overrideSelector(selectors.getOverriddenFeatureFlags, {});
    store.overrideSelector(
      selectors.getMetricsScalarSmoothing,
      METRICS_SETTINGS_DEFAULT.scalarSmoothing
    );

    queryParamsSerialized = [];

    provider = new DashboardDeepLinkProvider();
    provider
      .serializeStateToQueryParams(store)
      .pipe(
        // Skip the initial bootstrap.
        skip(1)
      )
      .subscribe((queryParams) => {
        queryParamsSerialized.push(queryParams);
      });
  });

  describe('time series', () => {
    describe('smoothing state', () => {
      it('serializes the smoothing state to the URL', () => {
        store.overrideSelector(selectors.getMetricsScalarSmoothing, 0);
        store.refreshState();

        expect(queryParamsSerialized[queryParamsSerialized.length - 1]).toEqual(
          [
            {
              key: 'smoothing',
              value: '0',
            },
          ]
        );
      });

      it('does not reflect default value to the URL', () => {
        store.overrideSelector(selectors.getMetricsScalarSmoothing, 0.6);
        store.refreshState();

        expect(queryParamsSerialized.length).toBe(0);
      });

      it('deserializes the state in the URL without much sanitization', () => {
        const state1 = provider.deserializeQueryParams([
          {key: 'smoothing', value: '0.3'},
        ]);
        expect(state1.metrics.smoothing).toBe(0.3);

        const state2 = provider.deserializeQueryParams([
          {key: 'smoothing', value: '-0.3'},
        ]);
        expect(state2.metrics.smoothing).toBe(-0.3);
      });

      it('deserializes to null when smoothing is not provided', () => {
        const state = provider.deserializeQueryParams([]);
        expect(state.metrics.smoothing).toBe(null);
      });
    });

    describe('pinned state', () => {
      it('serializes pinned card state when store updates', () => {
        store.overrideSelector(selectors.getPinnedCardsWithMetadata, [
          {
            cardId: 'card1',
            plugin: PluginType.SCALARS,
            tag: 'accuracy',
            runId: null,
          },
        ]);
        store.overrideSelector(selectors.getUnresolvedImportedPinnedCards, [
          {
            plugin: PluginType.SCALARS,
            tag: 'loss',
          },
        ]);
        store.refreshState();

        expect(queryParamsSerialized[queryParamsSerialized.length - 1]).toEqual(
          [
            {
              key: 'pinnedCards',
              value:
                '[{"plugin":"scalars","tag":"accuracy"},{"plugin":"scalars","tag":"loss"}]',
            },
          ]
        );

        store.overrideSelector(selectors.getPinnedCardsWithMetadata, [
          {
            cardId: 'card1',
            plugin: PluginType.SCALARS,
            tag: 'accuracy2',
            runId: null,
          },
        ]);
        store.overrideSelector(selectors.getUnresolvedImportedPinnedCards, [
          {
            plugin: PluginType.SCALARS,
            tag: 'loss2',
          },
        ]);
        store.refreshState();

        expect(queryParamsSerialized[queryParamsSerialized.length - 1]).toEqual(
          [
            {
              key: 'pinnedCards',
              value:
                '[{"plugin":"scalars","tag":"accuracy2"},{"plugin":"scalars","tag":"loss2"}]',
            },
          ]
        );
      });

      it('serializes nothing when states are empty', () => {
        store.overrideSelector(selectors.getPinnedCardsWithMetadata, []);
        store.overrideSelector(selectors.getUnresolvedImportedPinnedCards, []);
        store.refreshState();

        expect(queryParamsSerialized[queryParamsSerialized.length - 1]).toEqual(
          []
        );
      });

      it('deserializes empty pinned cards', () => {
        const state = provider.deserializeQueryParams([]);

        expect(state.metrics.pinnedCards).toEqual([]);
      });

      it('deserializes valid pinned cards', () => {
        const state = provider.deserializeQueryParams([
          {
            key: 'pinnedCards',
            value:
              '[{"plugin":"scalars","tag":"accuracy"},{"plugin":"images","tag":"loss","runId":"exp1/123","sample":5}]',
          },
        ]);

        expect(state.metrics).toEqual({
          pinnedCards: [
            {plugin: PluginType.SCALARS, tag: 'accuracy'},
            {
              plugin: PluginType.IMAGES,
              tag: 'loss',
              runId: 'exp1/123',
              sample: 5,
            },
          ],
          smoothing: null,
        });
      });

      it('sanitizes pinned cards on deserialization', () => {
        const cases = [
          {
            // malformed URL value
            serializedValue: 'blah[{"plugin":"scalars","tag":"accuracy"}]',
            expectedPinnedCards: [],
          },
          {
            // no plugin
            serializedValue:
              '[{"tag":"loss"},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // unknown plugin
            serializedValue:
              '[{"plugin":"unknown","tag":"loss"},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // tag is not a string
            serializedValue:
              '[{"plugin":"scalars","tag":5},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // tag is empty
            serializedValue:
              '[{"plugin":"scalars","tag":""},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // runId is not a string
            serializedValue:
              '[{"plugin":"images","tag":"loss","runId":123},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // runId is empty
            serializedValue:
              '[{"plugin":"images","tag":"loss","runId":""},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // runId provided with multi-run plugin
            serializedValue:
              '[{"plugin":"scalars","tag":"loss","runId":"123"},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // sample provided with non-sampled plugin
            serializedValue:
              '[{"plugin":"scalars","tag":"loss","sample":5},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // sample is not a number
            serializedValue:
              '[{"plugin":"images","tag":"loss","sample":"5"},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // sample is not an integer
            serializedValue:
              '[{"plugin":"images","tag":"loss","sample":5.5},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
          {
            // sample is negative
            serializedValue:
              '[{"plugin":"images","tag":"loss","sample":-5},{"plugin":"scalars","tag":"default"}]',
            expectedPinnedCards: [{plugin: PluginType.SCALARS, tag: 'default'}],
          },
        ];
        for (const {serializedValue, expectedPinnedCards} of cases) {
          const state = provider.deserializeQueryParams([
            {key: 'pinnedCards', value: serializedValue},
          ]);

          expect(state.metrics.pinnedCards).toEqual(expectedPinnedCards);
        }
      });
    });
  });

  describe('feature flag', () => {
    beforeEach(() => {});

    it('serializes enabled experimental plugins', () => {
      store.overrideSelector(selectors.getEnabledExperimentalPlugins, [
        'foo',
        'bar',
        'baz',
      ]);
      store.refreshState();

      expect(queryParamsSerialized[queryParamsSerialized.length - 1]).toEqual([
        {key: 'experimentalPlugin', value: 'foo'},
        {key: 'experimentalPlugin', value: 'bar'},
        {key: 'experimentalPlugin', value: 'baz'},
      ]);
    });

    it('serializes enabled fast chart state', () => {
      store.overrideSelector(selectors.getOverriddenFeatureFlags, {
        enableGpuChart: false,
      });
      store.refreshState();

      expect(queryParamsSerialized[queryParamsSerialized.length - 1]).toEqual([
        {key: 'fastChart', value: 'false'},
      ]);

      store.overrideSelector(selectors.getOverriddenFeatureFlags, {
        enableGpuChart: true,
      });
      store.refreshState();

      expect(queryParamsSerialized[queryParamsSerialized.length - 1]).toEqual([
        {key: 'fastChart', value: 'true'},
      ]);
    });

    it('omits fast chart state if it is not overridden by user and has default value', () => {
      store.overrideSelector(selectors.getOverriddenFeatureFlags, {});
      store.refreshState();

      expect(queryParamsSerialized).toEqual([[]]);
    });
  });
});
